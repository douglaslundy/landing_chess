const { createOrder, getOrderByToken, getLatestAttempt } = require('./_lib/orders');
const { method, readJson, sendJson, getClientIp, publicOrder } = require('./_lib/http');
const { createOrderSchema, orderTokenSchema } = require('./_lib/schemas');
const { rateLimit } = require('./_lib/rate-limit');

module.exports = async function handler(req, res) {
  if (!method(req, res, ['GET', 'POST'])) return;
  try {
    const ip = getClientIp(req);
    const allowed = await rateLimit({ key: `orders:${ip}`, limit: 20, windowSeconds: 300 });
    if (!allowed) return sendJson(res, 429, { error: 'rate_limited' });

    if (req.method === 'POST') {
      const body = createOrderSchema.parse(await readJson(req));
      const order = await createOrder(body);
      return sendJson(res, 201, publicOrder(order, null));
    }

    const url = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
    const parsed = orderTokenSchema.parse({ orderToken: url.searchParams.get('token') });
    const order = await getOrderByToken(parsed.orderToken);
    if (!order) return sendJson(res, 404, { error: 'order_not_found' });
    const attempt = await getLatestAttempt(order.id);
    return sendJson(res, 200, publicOrder(order, attempt));
  } catch (error) {
    if (error.name === 'ZodError') return sendJson(res, 400, { error: 'invalid_input', details: error.issues });
    return sendJson(res, 500, { error: error.code || 'server_error', message: error.message });
  }
};
