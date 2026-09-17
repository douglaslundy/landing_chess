import { NextResponse } from 'next/server';
import { orderTokenSchema } from '../../../../lib/schemas.js';
import { getOrderByToken, getReusableAttempt, createAttempt, updateAttemptFromPayment, applyOfficialPayment } from '../../../../lib/orders.js';
import { createPayment } from '../../../../lib/mercadopago.js';
import { rateLimit } from '../../../../lib/rate-limit.js';
import { getClientIp, publicOrder } from '../../../../lib/http.js';

export async function POST(request) {
  try {
    const ip = getClientIp(request);
    const allowed = await rateLimit({ key: `pix:${ip}`, limit: 10, windowSeconds: 300 });
    if (!allowed) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

    let raw;
    try {
      raw = await request.json();
    } catch {
      raw = {};
    }
    const body = orderTokenSchema.parse(raw);
    const order = await getOrderByToken(body.orderToken);
    if (!order) return NextResponse.json({ error: 'order_not_found' }, { status: 404 });
    if (order.status === 'paid') return NextResponse.json(await publicOrder(order, null));

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
    return NextResponse.json(await publicOrder(refreshedOrder, attempt));
  } catch (error) {
    if (error.name === 'ZodError') {
      return NextResponse.json({ error: 'invalid_input', details: error.issues }, { status: 400 });
    }
    console.error('[api/payments/pix] failed:', error);
    return NextResponse.json({ error: 'payment_error', provider: error.body }, { status: error.status || 500 });
  }
}
