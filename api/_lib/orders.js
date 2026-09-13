const crypto = require('crypto');
const { withTransaction, query } = require('./db');
const { PRODUCT, CONFIRMED_PAYMENT_STATUS } = require('./constants');

function uuid() {
  return crypto.randomUUID();
}

async function createOrder({ buyerName, buyerEmail, documentType, documentNumber }) {
  const result = await query(
    `
    insert into orders (
      id, public_token, product_code, product_title, amount_cents, currency,
      buyer_name, buyer_email, document_type, document_number, status
    )
    values ($1, $2, $3, $4, $5, $6, $7, lower($8), $9, $10, 'created')
    returning *
    `,
    [
      uuid(),
      crypto.randomBytes(32).toString('hex'),
      PRODUCT.code,
      PRODUCT.title,
      PRODUCT.amountCents,
      PRODUCT.currency,
      buyerName,
      buyerEmail,
      documentType || null,
      documentNumber || null
    ]
  );
  return result.rows[0];
}

async function getOrderByToken(token) {
  const result = await query(
    `
    select o.*,
      coalesce(e.status, 'not_queued') as email_status,
      e.sent_at as email_sent_at
    from orders o
    left join outbox_emails e on e.order_id = o.id
    where o.public_token = $1
    `,
    [token]
  );
  return result.rows[0] || null;
}

async function getLatestAttempt(orderId) {
  const result = await query(
    `select * from payment_attempts where order_id = $1 order by created_at desc limit 1`,
    [orderId]
  );
  return result.rows[0] || null;
}

async function getReusableAttempt(orderId, method) {
  const result = await query(
    `
    select * from payment_attempts
    where order_id = $1
      and method = $2
      and status in ('created', 'pending', 'in_process')
      and created_at > now() - interval '45 minutes'
    order by created_at desc
    limit 1
    `,
    [orderId, method]
  );
  return result.rows[0] || null;
}

async function createAttempt(orderId, method) {
  const result = await query(
    `
    insert into payment_attempts (id, order_id, method, idempotency_key, status)
    values ($1, $2, $3, $4, 'created')
    returning *
    `,
    [uuid(), orderId, method, uuid()]
  );
  return result.rows[0];
}

async function updateAttemptFromPayment(attemptId, payment) {
  const pix = payment.point_of_interaction?.transaction_data || {};
  const result = await query(
    `
    update payment_attempts set
      mp_payment_id = $2,
      status = $3,
      status_detail = $4,
      amount_cents = round(($5::numeric) * 100)::int,
      currency = $6,
      qr_code = $7,
      qr_code_base64 = $8,
      ticket_url = $9,
      expires_at = $10,
      raw_response = $11::jsonb,
      updated_at = now()
    where id = $1
    returning *
    `,
    [
      attemptId,
      String(payment.id),
      payment.status,
      payment.status_detail || null,
      String(payment.transaction_amount || 0),
      payment.currency_id || PRODUCT.currency,
      pix.qr_code || null,
      pix.qr_code_base64 || null,
      pix.ticket_url || null,
      payment.date_of_expiration || null,
      JSON.stringify(payment)
    ]
  );
  return result.rows[0];
}

function internalStatusForPayment(status) {
  if (status === CONFIRMED_PAYMENT_STATUS) return 'paid';
  if (status === 'rejected') return 'rejected';
  if (status === 'cancelled') return 'cancelled';
  if (status === 'refunded') return 'refunded';
  if (status === 'charged_back') return 'charged_back';
  if (status === 'in_process') return 'processing';
  return 'pending';
}

async function applyOfficialPayment(payment) {
  return withTransaction(async (client) => {
    const orderId = payment.external_reference || payment.metadata?.order_id;
    if (!orderId) throw new Error('Pagamento sem external_reference/order_id');

    const orderResult = await client.query('select * from orders where id = $1 for update', [orderId]);
    const order = orderResult.rows[0];
    if (!order) throw new Error('Pedido local nao encontrado para pagamento oficial');

    const amountCents = Math.round(Number(payment.transaction_amount || 0) * 100);
    const receiverOk = !process.env.MERCADOPAGO_EXPECTED_COLLECTOR_ID ||
      String(payment.collector_id) === String(process.env.MERCADOPAGO_EXPECTED_COLLECTOR_ID);
    if (
      order.amount_cents !== amountCents ||
      order.currency !== payment.currency_id ||
      payment.metadata?.product_code !== PRODUCT.code ||
      !receiverOk
    ) {
      await client.query(
        `insert into provider_events (id, order_id, mp_payment_id, type, payload)
         values ($1, $2, $3, 'payment_mismatch', $4::jsonb)`,
        [uuid(), order.id, String(payment.id), JSON.stringify(payment)]
      );
      throw new Error('Divergencia entre pedido local e pagamento oficial');
    }

    await client.query(
      `
      update payment_attempts set
        mp_payment_id = $2,
        status = $3,
        status_detail = $4,
        amount_cents = $5,
        currency = $6,
        raw_response = $7::jsonb,
        updated_at = now()
      where order_id = $1 and (mp_payment_id = $2 or id = $8)
      `,
      [
        order.id,
        String(payment.id),
        payment.status,
        payment.status_detail || null,
        amountCents,
        payment.currency_id,
        JSON.stringify(payment),
        payment.metadata?.attempt_id || null
      ]
    );

    const nextStatus = internalStatusForPayment(payment.status);
    const confirmed = payment.status === CONFIRMED_PAYMENT_STATUS;
    const orderUpdate = await client.query(
      `
      update orders set
        status = case
          when status = 'paid' and $2 <> 'refunded' and $2 <> 'charged_back' then status
          else $2
        end,
        payment_confirmed_at = case
          when $3::boolean and payment_confirmed_at is null then now()
          else payment_confirmed_at
        end,
        updated_at = now()
      where id = $1
      returning *
      `,
      [order.id, nextStatus, confirmed]
    );

    if (confirmed) {
      await client.query(
        `
        insert into outbox_emails (id, order_id, status, next_attempt_at)
        values ($1, $2, 'pending', now())
        on conflict (order_id) do nothing
        `,
        [uuid(), order.id]
      );
    }

    if (payment.status === 'refunded' || payment.status === 'charged_back') {
      await client.query(
        `
        insert into provider_events (id, order_id, mp_payment_id, type, payload)
        values ($1, $2, $3, $4, $5::jsonb)
        on conflict do nothing
        `,
        [uuid(), order.id, String(payment.id), payment.status, JSON.stringify(payment)]
      );
    }

    return orderUpdate.rows[0];
  });
}

module.exports = {
  createOrder,
  getOrderByToken,
  getLatestAttempt,
  getReusableAttempt,
  createAttempt,
  updateAttemptFromPayment,
  applyOfficialPayment
};
