const { serverConfig } = require('./env');
const { PRODUCT } = require('./constants');

function amountFromCents(cents) {
  return Number((cents / 100).toFixed(2));
}

async function mercadoPagoRequest(path, options = {}) {
  const { mercadoPagoAccessToken } = serverConfig();
  const response = await fetch(`https://api.mercadopago.com${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${mercadoPagoAccessToken}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const error = new Error(`Mercado Pago retornou HTTP ${response.status}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

async function createPayment({ order, attempt, payment }) {
  const { appBaseUrl } = serverConfig();
  const body = {
    transaction_amount: amountFromCents(PRODUCT.amountCents),
    description: PRODUCT.description,
    external_reference: order.id,
    notification_url: `${appBaseUrl}/api/mercadopago/webhook`,
    metadata: {
      order_id: order.id,
      product_code: PRODUCT.code,
      attempt_id: attempt.id
    },
    payer: {
      email: order.buyer_email,
      first_name: order.buyer_name,
      identification: order.document_type && order.document_number ? {
        type: order.document_type,
        number: order.document_number
      } : undefined
    },
    ...payment
  };

  return mercadoPagoRequest('/v1/payments', {
    method: 'POST',
    headers: { 'X-Idempotency-Key': attempt.idempotency_key },
    body: JSON.stringify(body)
  });
}

function getPayment(paymentId) {
  return mercadoPagoRequest(`/v1/payments/${encodeURIComponent(paymentId)}`);
}

function searchPaymentsByExternalReference(orderId) {
  return mercadoPagoRequest(`/v1/payments/search?external_reference=${encodeURIComponent(orderId)}`);
}

module.exports = {
  amountFromCents,
  createPayment,
  getPayment,
  searchPaymentsByExternalReference
};
