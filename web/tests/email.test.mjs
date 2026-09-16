import { describe, expect, it } from 'vitest';
import { buildEmail } from '../lib/email.js';

process.env.APP_BASE_URL = 'https://app.example';
process.env.MERCADOPAGO_ACCESS_TOKEN = 'TEST-token';
process.env.DATABASE_URL = 'postgres://user:pass@example/db';
process.env.PRODUCT_ACCESS_URL = 'https://produto.example/acesso';
process.env.CRON_SECRET = 'secret';

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

  it('includes the magic link when one is provided', () => {
    const email = buildEmail(
      { id: 'order-id', buyer_name: 'Douglas' },
      'https://app.example/api/client/magic-link/consume?token=abc123'
    );

    expect(email.text).toContain('https://app.example/api/client/magic-link/consume?token=abc123');
    expect(email.html).toContain('https://app.example/api/client/magic-link/consume?token=abc123');
  });

  it('omits any magic-link mention when none is provided', () => {
    const email = buildEmail({ id: 'order-id', buyer_name: 'Douglas' });
    expect(email.text).not.toContain('magic-link');
    expect(email.html).not.toContain('magic-link');
  });
});
