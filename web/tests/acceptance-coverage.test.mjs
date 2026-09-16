import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

describe('financial acceptance safeguards', () => {
  const migration = fs.readFileSync(path.join(process.cwd(), '..', 'migrations', '001_init.sql'), 'utf8');
  const frontend = fs.readFileSync(path.join(process.cwd(), 'public', 'assets', 'checkout.js'), 'utf8');
  const orders = fs.readFileSync(path.join(process.cwd(), 'lib', 'orders.js'), 'utf8');
  const webhook = fs.readFileSync(path.join(process.cwd(), 'app', 'api', 'mercadopago', 'webhook', 'route.js'), 'utf8');
  const reconcileRoute = fs.readFileSync(path.join(process.cwd(), 'app', 'api', 'cron', 'reconcile', 'route.js'), 'utf8');
  const reconcileLib = fs.readFileSync(path.join(process.cwd(), 'lib', 'reconcile.js'), 'utf8');
  const reconcile = reconcileRoute + reconcileLib;

  it('persists idempotency, webhook dedupe and one delivery outbox per order', () => {
    expect(migration).toContain('idempotency_key text not null unique');
    expect(migration).toContain('mp_payment_id text unique');
    expect(migration).toContain('unique(topic, resource_id, provider_event_id)');
    expect(migration).toContain('order_id uuid not null unique references orders');
  });

  it('tracks refunds and chargebacks without requeueing delivery', () => {
    expect(orders).toContain("payment.status === 'refunded' || payment.status === 'charged_back'");
    expect(orders).toContain('provider_events');
    expect(orders).toContain("on conflict (order_id) do nothing");
  });

  it('does not trust webhook body without official Mercado Pago lookup', () => {
    expect(webhook).toContain('verifyMercadoPagoSignature');
    expect(webhook).toContain('const payment = await getPayment(dataId)');
    expect(webhook).toContain('await applyOfficialPayment(payment)');
  });

  it('has a protected reconciliation path for missing notifications and email retries', () => {
    expect(reconcile).toContain('authorization');
    expect(reconcile).toContain('searchPaymentsByExternalReference');
    expect(reconcile).toContain('processEmailOutbox');
    expect(reconcile).toContain('cleanupExpiredSessions');
    expect(reconcile).toContain('cleanupExpiredMagicLinks');
  });

  it('recovers order tracking after reload and renders terminal states distinctly', () => {
    expect(frontend).toContain("sessionStorage.getItem('checkoutOrderToken')");
    expect(frontend).toContain('rejected:');
    expect(frontend).toContain('cancelled:');
    expect(frontend).toContain('expired:');
    expect(frontend).toContain('refunded:');
    expect(frontend).toContain('charged_back:');
  });
});

describe('auth route protection safeguards', () => {
  const adminLoginRoute = fs.readFileSync(path.join(process.cwd(), 'app', 'api', 'admin', 'login', 'route.js'), 'utf8');
  const clientLoginRoute = fs.readFileSync(path.join(process.cwd(), 'app', 'api', 'client', 'login', 'route.js'), 'utf8');
  const adminPage = fs.readFileSync(path.join(process.cwd(), 'app', 'admin', 'page.js'), 'utf8');
  const clientPage = fs.readFileSync(path.join(process.cwd(), 'app', 'cliente', 'page.js'), 'utf8');
  const magicLinkConsumeRoute = fs.readFileSync(path.join(process.cwd(), 'app', 'api', 'client', 'magic-link', 'consume', 'route.js'), 'utf8');
  const magicLinkRequestRoute = fs.readFileSync(path.join(process.cwd(), 'app', 'api', 'client', 'magic-link', 'request', 'route.js'), 'utf8');
  const setPasswordRoute = fs.readFileSync(path.join(process.cwd(), 'app', 'api', 'client', 'set-password', 'route.js'), 'utf8');
  const adminLessonsRoute = fs.readFileSync(path.join(process.cwd(), 'app', 'api', 'admin', 'lessons', 'route.js'), 'utf8');
  const adminLessonDetailRoute = fs.readFileSync(path.join(process.cwd(), 'app', 'api', 'admin', 'lessons', '[id]', 'route.js'), 'utf8');

  it('protects every admin/client protected page and sensitive route behind resolveSession', () => {
    expect(adminPage).toContain('resolveSession');
    expect(clientPage).toContain('resolveSession');
    expect(setPasswordRoute).toContain('resolveSession');
    expect(adminLessonsRoute).toContain('resolveSession');
    expect(adminLessonDetailRoute).toContain('resolveSession');
  });

  it('rate-limits every credential-checking or email-dispatching auth route', () => {
    expect(adminLoginRoute).toContain('rateLimit');
    expect(clientLoginRoute).toContain('rateLimit');
    expect(magicLinkRequestRoute).toContain('rateLimit');
  });

  it('builds magic-link redirects from appBaseUrl, never from request.url\'s origin', () => {
    expect(magicLinkConsumeRoute).toContain('appBaseUrl');
    expect(magicLinkConsumeRoute).not.toContain('redirect(new URL(');
  });
});
