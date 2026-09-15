import { describe, expect, it } from 'vitest';
import { createOrderSchema, cardPaymentSchema } from '../lib/schemas.js';
import { PRODUCT } from '../lib/constants.js';

describe('checkout input validation', () => {
  it('does not accept price or product values from the browser when creating orders', () => {
    const parsed = createOrderSchema.parse({
      buyerName: 'Douglas Lundy',
      buyerEmail: 'douglas@example.com',
      amountCents: 1,
      productCode: 'alterado'
    });

    expect(parsed.amountCents).toBeUndefined();
    expect(PRODUCT.amountCents).toBe(3990);
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
