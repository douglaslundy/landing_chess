import crypto from 'crypto';
import { describe, expect, it } from 'vitest';
import { verifyMercadoPagoSignature } from '../lib/webhook.js';

describe('Mercado Pago webhook signature', () => {
  it('validates the signed manifest with data id, request id and timestamp', () => {
    const secret = 'secret';
    const dataId = '123456';
    const requestId = 'bb56a2f1-6aae-46ac-982e-9dcd3581d08e';
    const ts = '1742505638683';
    const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
    const signature = crypto.createHmac('sha256', secret).update(manifest).digest('hex');

    expect(verifyMercadoPagoSignature({
      xSignature: `ts=${ts},v1=${signature}`,
      xRequestId: requestId,
      dataId,
      secret
    })).toBe(true);
  });

  it('rejects tampered resource ids', () => {
    const secret = 'secret';
    const requestId = 'request';
    const ts = '1';
    const signature = crypto.createHmac('sha256', secret).update(`id:original;request-id:${requestId};ts:${ts};`).digest('hex');

    expect(verifyMercadoPagoSignature({
      xSignature: `ts=${ts},v1=${signature}`,
      xRequestId: requestId,
      dataId: 'other',
      secret
    })).toBe(false);
  });

  it('rejects malformed signatures without throwing', () => {
    expect(verifyMercadoPagoSignature({
      xSignature: 'ts=1,v1=bad',
      xRequestId: 'request',
      dataId: '123',
      secret: 'secret'
    })).toBe(false);
  });
});
