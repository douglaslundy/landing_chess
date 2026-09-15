import crypto from 'node:crypto';

export function parseSignature(signature) {
  return String(signature || '').split(',').reduce((acc, item) => {
    const [key, value] = item.split('=');
    if (key && value) acc[key.trim()] = value.trim();
    return acc;
  }, {});
}

export function verifyMercadoPagoSignature({ xSignature, xRequestId, dataId, secret }) {
  if (!secret) return false;
  const parsed = parseSignature(xSignature);
  if (!parsed.ts || !parsed.v1 || !xRequestId || !dataId) return false;
  const manifest = `id:${dataId};request-id:${xRequestId};ts:${parsed.ts};`;
  const expected = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(parsed.v1);
  if (expectedBuffer.length !== receivedBuffer.length) return false;
  return crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}
