export function getClientIp(request) {
  const forwarded = request.headers.get('x-forwarded-for');
  if (typeof forwarded === 'string' && forwarded) return forwarded.split(',')[0].trim();
  return 'unknown';
}

export function publicOrder(order, attempt) {
  return {
    token: order.public_token,
    status: order.status,
    buyerName: order.buyer_name,
    buyerEmail: order.buyer_email,
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
    // The product URL is server-only until the payment is officially confirmed.
    accessUrl: order.status === 'paid' ? process.env.PRODUCT_ACCESS_URL || null : null
  };
}
