import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();

vi.mock('pg', () => ({
  Pool: vi.fn().mockImplementation(function PoolMock() {
    return { query: queryMock };
  })
}));

const { resetPoolForTests } = await import('../lib/db.js');
const { createOrderSchema, cardPaymentSchema } = await import('../lib/schemas.js');
const { getProductSettings } = await import('../lib/settings.js');

describe('checkout input validation', () => {
  beforeEach(() => {
    process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
    resetPoolForTests();
    queryMock.mockReset();
  });

  afterEach(() => {
    delete process.env.DATABASE_URL;
  });

  it('does not accept price or product values from the browser when creating orders', () => {
    const parsed = createOrderSchema.parse({
      buyerName: 'Douglas Lundy',
      buyerEmail: 'douglas@example.com',
      amountCents: 1,
      productCode: 'alterado'
    });

    expect(parsed.amountCents).toBeUndefined();
  });

  it('always reads the current price from settings, never from client input', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ value: 'Xadrez Essencial', encrypted: false }] })
      .mockResolvedValueOnce({ rows: [{ value: 'desc', encrypted: false }] })
      .mockResolvedValueOnce({ rows: [{ value: '3990', encrypted: false }] })
      .mockResolvedValueOnce({ rows: [{ value: 'BRL', encrypted: false }] });

    const product = await getProductSettings();
    expect(product.amountCents).toBe(3990);
  });

  it('accepts only card tokenization payload, never full card number or cvv fields', () => {
    const parsed = cardPaymentSchema.parse({
      orderToken: 'a'.repeat(64),
      token: 'card_token',
      paymentMethodId: 'visa',
      installments: 1,
      cardNumber: '4111111111111111',
      securityCode: '123'
    });

    expect(parsed.cardNumber).toBeUndefined();
    expect(parsed.securityCode).toBeUndefined();
    expect(parsed.token).toBe('card_token');
  });
});
