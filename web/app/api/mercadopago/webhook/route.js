import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { query } from '../../../../lib/db.js';
import { getPayment } from '../../../../lib/mercadopago.js';
import { applyOfficialPayment } from '../../../../lib/orders.js';
import { processEmailOutbox } from '../../../../lib/email.js';
import { verifyMercadoPagoSignature } from '../../../../lib/webhook.js';
import { optional } from '../../../../lib/env.js';

export async function POST(request) {
  try {
    const url = new URL(request.url);
    let body;
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const dataId = url.searchParams.get('data.id') || body.data?.id;
    const type = url.searchParams.get('type') || body.type;
    const secret = optional('MERCADOPAGO_WEBHOOK_SECRET');

    const signatureValid = secret ? verifyMercadoPagoSignature({
      xSignature: request.headers.get('x-signature'),
      xRequestId: request.headers.get('x-request-id'),
      dataId,
      secret
    }) : false;

    if (!signatureValid) {
      await query(
        `insert into webhook_events (id, provider_event_id, topic, resource_id, signature_valid, payload)
         values ($1, $2, $3, $4, false, $5::jsonb)`,
        [crypto.randomUUID(), String(body.id || ''), String(type || ''), String(dataId || ''), JSON.stringify(body)]
      );
      return NextResponse.json({ error: 'invalid_signature' }, { status: 401 });
    }

    await query(
      `
      insert into webhook_events (id, provider_event_id, topic, resource_id, signature_valid, payload)
      values ($1, $2, $3, $4, $5, $6::jsonb)
      on conflict (topic, resource_id, provider_event_id) do update set received_at = now()
      `,
      [crypto.randomUUID(), String(body.id || ''), String(type || ''), String(dataId || ''), signatureValid, JSON.stringify(body)]
    );

    if (type === 'payment' && dataId) {
      const payment = await getPayment(dataId);
      await applyOfficialPayment(payment);
      await processEmailOutbox(5);
      await query(
        `update webhook_events set processed_at = now() where topic = $1 and resource_id = $2`,
        [String(type), String(dataId)]
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[api/mercadopago/webhook] failed:', error);
    return NextResponse.json({ error: 'webhook_processing_error' }, { status: 500 });
  }
}
