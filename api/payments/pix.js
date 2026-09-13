const { method, readJson, sendJson, getClientIp, publicOrder } = require('../_lib/http');
const { orderTokenSchema } = require('../_lib/schemas');
const { getOrderByToken, getReusableAttempt, createAttempt, updateAttemptFromPayment, applyOfficialPayment } = require('../_lib/orders');
const { createPayment } = require('../_lib/mercadopago');
const { rateLimit } = require('../_lib/rate-limit');

module.exports = async function handler(req, res) {
  if (!method(req, res, ['POST'])) return;
  try {
    const ip = getClientIp(req);
    const allowed = await rateLimit({ key: `pix:${ip}`, limit: 10, windowSeconds: 300 });
    if (!allowed) return sendJson(res, 429, { error: 'rate_limited' });

    const body = orderTokenSchema.parse(await readJson(req));
    const order = await getOrderByToken(body.orderToken);
    if (!order) return sendJson(res, 404, { error: 'order_not_found' });
    if (order.status === 'paid') return sendJson(res, 200, publicOrder(order, null));

    let attempt = await getReusableAttempt(order.id, 'pix');
    if (!attempt) attempt = await createAttempt(order.id, 'pix');
    if (!attempt.mp_payment_id) {
      const payment = await createPayment({
        order,
        attempt,
        payment: {
          payment_method_id: 'pix',
          date_of_expiration: new Date(Date.now() + 30 * 60 * 1000).toISOString()
        }
      });
      attempt = await updateAttemptFromPayment(attempt.id, payment);
      await applyOfficialPayment(payment);
    }
    const refreshedOrder = await getOrderByToken(body.orderToken);
    sendJson(res, 200, publicOrder(refreshedOrder, attempt));
  } catch (error) {
    if (error.name === 'ZodError') return sendJson(res, 400, { error: 'invalid_input', details: error.issues });
    sendJson(res, error.status || 500, { error: 'payment_error', message: error.message, provider: error.body });
  }
};
