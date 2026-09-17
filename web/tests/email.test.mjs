import { describe, expect, it } from 'vitest';
import { buildEmail } from '../lib/email.js';

describe('delivery email', () => {
  it('renders html and text with the given product URL', () => {
    const email = buildEmail(
      { id: 'order-id', buyer_name: 'Douglas', product_title: 'Xadrez Essencial' },
      { productAccessUrl: 'https://produto.example/acesso' }
    );

    expect(email.subject).toContain('Xadrez Essencial');
    expect(email.text).toContain('https://produto.example/acesso');
    expect(email.html).toContain('https://produto.example/acesso');
  });

  it('includes the magic link when one is provided', () => {
    const email = buildEmail(
      { id: 'order-id', buyer_name: 'Douglas', product_title: 'Xadrez Essencial' },
      {
        magicLinkUrl: 'https://app.example/api/client/magic-link/consume?token=abc123',
        productAccessUrl: 'https://produto.example/acesso'
      }
    );

    expect(email.text).toContain('https://app.example/api/client/magic-link/consume?token=abc123');
    expect(email.html).toContain('https://app.example/api/client/magic-link/consume?token=abc123');
  });

  it('omits any magic-link mention when none is provided', () => {
    const email = buildEmail(
      { id: 'order-id', buyer_name: 'Douglas', product_title: 'Xadrez Essencial' },
      { productAccessUrl: 'https://produto.example/acesso' }
    );
    expect(email.text).not.toContain('magic-link');
    expect(email.html).not.toContain('magic-link');
  });

  it("uses the order's own product title, not a global constant", () => {
    const email = buildEmail(
      { id: 'order-id', buyer_name: 'Douglas', product_title: 'Nome Diferente' },
      { productAccessUrl: 'https://produto.example/acesso' }
    );
    expect(email.html).toContain('Nome Diferente');
  });
});
