import { createRequire } from 'module';
import { describe, expect, it } from 'vitest';

process.env.APP_BASE_URL = 'https://app.example';
process.env.MERCADOPAGO_ACCESS_TOKEN = 'TEST-token';
process.env.DATABASE_URL = 'postgres://user:pass@example/db';
process.env.PRODUCT_ACCESS_URL = 'https://produto.example/acesso';
process.env.CRON_SECRET = 'secret';

const require = createRequire(import.meta.url);
const { buildEmail } = require('../api/_lib/email');

describe('delivery email', () => {
  it('renders html and text with the server-only product URL', () => {
    const email = buildEmail({
      id: 'order-id',
      buyer_name: 'Douglas'
    });

    expect(email.subject).toContain('Xadrez Essencial');
    expect(email.text).toContain('https://produto.example/acesso');
    expect(email.html).toContain('https://produto.example/acesso');
  });
});
