import { NextResponse } from 'next/server';
import { createOrder, getOrderByToken, getLatestAttempt } from '../../../lib/orders.js';
import { getClientIp, publicOrder } from '../../../lib/http.js';
import { createOrderSchema, orderTokenSchema } from '../../../lib/schemas.js';
import { rateLimit } from '../../../lib/rate-limit.js';

export async function GET(request) {
  try {
    const ip = getClientIp(request);
    const allowed = await rateLimit({ key: `orders:${ip}`, limit: 20, windowSeconds: 300 });
    if (!allowed) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

    const url = new URL(request.url);
    const parsed = orderTokenSchema.parse({ orderToken: url.searchParams.get('token') });
    const order = await getOrderByToken(parsed.orderToken);
    if (!order) return NextResponse.json({ error: 'order_not_found' }, { status: 404 });
    const attempt = await getLatestAttempt(order.id);
    return NextResponse.json(publicOrder(order, attempt));
  } catch (error) {
    if (error.name === 'ZodError') {
      return NextResponse.json({ error: 'invalid_input', details: error.issues }, { status: 400 });
    }
    console.error('[api/orders GET] failed:', error);
    return NextResponse.json({ error: error.code || 'server_error' }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const ip = getClientIp(request);
    const allowed = await rateLimit({ key: `orders:${ip}`, limit: 20, windowSeconds: 300 });
    if (!allowed) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

    const body = createOrderSchema.parse(await request.json());
    const order = await createOrder(body);
    return NextResponse.json(publicOrder(order, null), { status: 201 });
  } catch (error) {
    if (error.name === 'ZodError') {
      return NextResponse.json({ error: 'invalid_input', details: error.issues }, { status: 400 });
    }
    console.error('[api/orders POST] failed:', error);
    return NextResponse.json({ error: error.code || 'server_error' }, { status: 500 });
  }
}
