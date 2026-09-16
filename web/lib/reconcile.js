import { query } from './db.js';
import { getPayment, searchPaymentsByExternalReference } from './mercadopago.js';
import { applyOfficialPayment } from './orders.js';
import { processEmailOutbox } from './email.js';
import { cleanupExpiredSessions } from './auth/session.js';
import { cleanupExpiredMagicLinks } from './auth/magicLink.js';

export async function runReconciliation() {
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
  const sessionsCleaned = await cleanupExpiredSessions();
  const magicLinksCleaned = await cleanupExpiredMagicLinks();
  return { reconciled, emails, sessionsCleaned, magicLinksCleaned };
}
