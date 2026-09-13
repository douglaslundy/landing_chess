const { method, sendJson } = require('../_lib/http');
const { required } = require('../_lib/env');
const { query } = require('../_lib/db');
const { getPayment, searchPaymentsByExternalReference } = require('../_lib/mercadopago');
const { applyOfficialPayment } = require('../_lib/orders');
const { processEmailOutbox } = require('../_lib/email');

module.exports = async function handler(req, res) {
  if (!method(req, res, ['POST', 'GET'])) return;
  try {
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${required('CRON_SECRET')}`) {
      return sendJson(res, 401, { error: 'unauthorized' });
    }

    const pendingAttempts = await query(
      `
      select distinct on (o.id) o.id as order_id, a.mp_payment_id
      from orders o
      left join payment_attempts a on a.order_id = o.id
      where o.status in ('created', 'pending', 'processing')
        and o.created_at > now() - interval '45 days'
      order by o.id, a.created_at desc
      limit 50
      `
    );

    const reconciled = [];
    for (const row of pendingAttempts.rows) {
      if (row.mp_payment_id) {
        const payment = await getPayment(row.mp_payment_id);
        await applyOfficialPayment(payment);
        reconciled.push(row.mp_payment_id);
      } else {
        const search = await searchPaymentsByExternalReference(row.order_id);
        for (const payment of search.results || []) {
          await applyOfficialPayment(payment);
          reconciled.push(String(payment.id));
        }
      }
    }

    const emails = await processEmailOutbox(20);
    sendJson(res, 200, { reconciled, emails });
  } catch (error) {
    sendJson(res, 500, { error: 'reconcile_error', message: error.message });
  }
};
