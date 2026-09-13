import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

describe('landing checkout frontend', () => {
  const html = fs.readFileSync(path.join(process.cwd(), 'index.html'), 'utf8');
  const js = fs.readFileSync(path.join(process.cwd(), 'assets', 'checkout.js'), 'utf8');

  it('does not expose the product access URL in the public bundle', () => {
    expect(html).not.toContain('PRODUCT_ACCESS_URL');
    expect(js).not.toContain('PRODUCT_ACCESS_URL');
  });

  it('uses backend polling and MercadoPago.js tokenized card form', () => {
    expect(html).toContain('https://sdk.mercadopago.com/js/v2');
    expect(js).toContain('/api/orders?token=');
    expect(js).toContain('mp.cardForm');
    expect(js).toContain('/api/payments/pix');
    expect(js).toContain('/api/payments/card');
  });
});
