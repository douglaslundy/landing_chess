const { method, readJson, sendJson, getClientIp, publicOrder } = require('../_lib/http');
const { cardPaymentSchema } = require('../_lib/schemas');
const { getOrderByToken, createAttempt, updateAttemptFromPayment, applyOfficialPayment } = require('../_lib/orders');
const { createPayment } = require('../_lib/mercadopago');
const { rateLimit } = require('../_lib/rate-limit');

module.exports = async function handler(req, res) {
  if (!method(req, res, ['POST'])) return;
  try {
    const ip = getClientIp(req);
    const allowed = await rateLimit({ key: `card:${ip}`, limit: 8, windowSeconds: 300 });
    if (!allowed) return sendJson(res, 429, { error: 'rate_limited' });

    const body = cardPaymentSchema.parse(await readJson(req));
    const order = await getOrderByToken(body.orderToken);
    if (!order) return sendJson(res, 404, { error: 'order_not_found' });
    if (order.status === 'paid') return sendJson(res, 200, publicOrder(order, null));

    let attempt = await createAttempt(order.id, 'card');
    const payment = await createPayment({
      order: {
        ...order,
        document_type: body.identificationType || order.document_type,
        document_number: body.identificationNumber || order.document_number
      },
      attempt,
      payment: {
        token: body.token,
        installments: body.installments,
        payment_method_id: body.paymentMethodId,
        issuer_id: body.issuerId || undefined,
        binary_mode: false,
        additional_info: {
          items: [{
            id: order.product_code,
            title: order.product_title,
            quantity: 1,
            unit_price: order.amount_cents / 100
          }]
        }
      }
    });
    attempt = await updateAttemptFromPayment(attempt.id, payment);
    if (payment.status) await applyOfficialPayment(payment);
    const refreshedOrder = await getOrderByToken(body.orderToken);
    sendJson(res, 200, publicOrder(refreshedOrder, attempt));
  } catch (error) {
    if (error.name === 'ZodError') return sendJson(res, 400, { error: 'invalid_input', details: error.issues });
    sendJson(res, error.status || 500, { error: 'payment_error', message: error.message, provider: error.body });
  }
};
