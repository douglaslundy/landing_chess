const { method, readJson, sendJson } = require('../_lib/http');
const { query } = require('../_lib/db');
const { getPayment } = require('../_lib/mercadopago');
const { applyOfficialPayment } = require('../_lib/orders');
const { processEmailOutbox } = require('../_lib/email');
const { verifyMercadoPagoSignature } = require('../_lib/webhook');
const { optional } = require('../_lib/env');
const crypto = require('crypto');

module.exports = async function handler(req, res) {
  if (!method(req, res, ['POST'])) return;
  try {
    const url = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
    const body = await readJson(req);
    const dataId = url.searchParams.get('data.id') || body.data?.id;
    const type = url.searchParams.get('type') || body.type;
    const secret = optional('MERCADOPAGO_WEBHOOK_SECRET');

    const signatureValid = secret ? verifyMercadoPagoSignature({
      xSignature: req.headers['x-signature'],
      xRequestId: req.headers['x-request-id'],
      dataId,
      secret
    }) : false;

    if (secret && !signatureValid) {
      await query(
        `insert into webhook_events (id, provider_event_id, topic, resource_id, signature_valid, payload)
         values ($1, $2, $3, $4, false, $5::jsonb)`,
        [crypto.randomUUID(), String(body.id || ''), String(type || ''), String(dataId || ''), JSON.stringify(body)]
      );
      return sendJson(res, 401, { error: 'invalid_signature' });
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

    sendJson(res, 200, { ok: true });
  } catch (error) {
    sendJson(res, 500, { error: 'webhook_processing_error', message: error.message });
  }
};
