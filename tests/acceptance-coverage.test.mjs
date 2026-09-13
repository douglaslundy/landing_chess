import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

describe('financial acceptance safeguards', () => {
  const migration = fs.readFileSync(path.join(process.cwd(), 'migrations', '001_init.sql'), 'utf8');
  const frontend = fs.readFileSync(path.join(process.cwd(), 'assets', 'checkout.js'), 'utf8');
  const orders = fs.readFileSync(path.join(process.cwd(), 'api', '_lib', 'orders.js'), 'utf8');
  const webhook = fs.readFileSync(path.join(process.cwd(), 'api', 'mercadopago', 'webhook.js'), 'utf8');
  const reconcile = fs.readFileSync(path.join(process.cwd(), 'api', 'cron', 'reconcile.js'), 'utf8');

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
