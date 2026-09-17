import { getProductAccessUrl } from './settings.js';

export function getClientIp(request) {
  // Domain is Cloudflare-proxied; Traefik has no forwardedHeaders.trustedIPs
  // configured, so X-Forwarded-For gets overwritten with Cloudflare's edge
  // IP rather than the real visitor. CF-Connecting-IP is Cloudflare's own
  // edge-set header (not client-spoofable) and reflects the real visitor.
  const cfIp = request.headers.get('cf-connecting-ip');
  if (typeof cfIp === 'string' && cfIp) return cfIp.trim();
  const forwarded = request.headers.get('x-forwarded-for');
  if (typeof forwarded === 'string' && forwarded) return forwarded.split(',')[0].trim();
  return 'unknown';
}

export async function publicOrder(order, attempt) {
  const accessUrl = order.status === 'paid' ? await getProductAccessUrl().catch(() => null) : null;
  return {
    token: order.public_token,
    status: order.status,
    buyerName: order.buyer_name,
    buyerEmail: order.buyer_email,
    documentType: order.document_type,
    documentNumber: order.document_number,
    product: {
      title: order.product_title,
      amountCents: order.amount_cents,
      currency: order.currency
    },
    payment: attempt ? {
      method: attempt.method,
      status: attempt.status,
      statusDetail: attempt.status_detail,
      qrCode: attempt.qr_code,
      qrCodeBase64: attempt.qr_code_base64,
      ticketUrl: attempt.ticket_url,
      expiresAt: attempt.expires_at
    } : null,
    confirmedAt: order.payment_confirmed_at,
    emailStatus: order.email_status || 'not_queued',
    emailSentAt: order.email_sent_at,
    accessUrl
  };
}
