export const TERMINAL_PAYMENT_STATUSES = new Set([
  'approved',
  'authorized',
  'rejected',
  'cancelled',
  'refunded',
  'charged_back'
]);

export const CONFIRMED_PAYMENT_STATUS = 'approved';

export const SESSION_TTL_SECONDS = Object.freeze({
  admin: 7 * 24 * 60 * 60,
  client: 30 * 24 * 60 * 60
});

export const MAGIC_LINK_TTL_SECONDS = 30 * 60;
