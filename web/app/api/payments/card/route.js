import { NextResponse } from 'next/server';
import { cardPaymentSchema } from '../../../../lib/schemas.js';
import { getOrderByToken, createAttempt, updateAttemptFromPayment, applyOfficialPayment } from '../../../../lib/orders.js';
import { createPayment } from '../../../../lib/mercadopago.js';
import { rateLimit } from '../../../../lib/rate-limit.js';
import { getClientIp, publicOrder } from '../../../../lib/http.js';

export async function POST(request) {
  try {
    const ip = getClientIp(request);
    const allowed = await rateLimit({ key: `card:${ip}`, limit: 8, windowSeconds: 300 });
    if (!allowed) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

    let raw;
    try {
      raw = await request.json();
    } catch {
      raw = {};
    }
    const body = cardPaymentSchema.parse(raw);
    const order = await getOrderByToken(body.orderToken);
    if (!order) return NextResponse.json({ error: 'order_not_found' }, { status: 404 });
    if (order.status === 'paid') return NextResponse.json(await publicOrder(order, null));

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
    return NextResponse.json(await publicOrder(refreshedOrder, attempt));
  } catch (error) {
    if (error.name === 'ZodError') {
      return NextResponse.json({ error: 'invalid_input', details: error.issues }, { status: 400 });
    }
    console.error('[api/payments/card] failed:', error);
    return NextResponse.json({ error: 'payment_error', provider: error.body }, { status: error.status || 500 });
  }
}
