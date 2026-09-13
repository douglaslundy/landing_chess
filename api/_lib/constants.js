const PRODUCT = Object.freeze({
  code: 'xadrez-essencial-pdf',
  title: 'Xadrez Essencial',
  description: 'Livro digital Xadrez Essencial, 10 volumes em PDF',
  amountCents: 3990,
  currency: 'BRL'
});

const TERMINAL_PAYMENT_STATUSES = new Set([
  'approved',
  'authorized',
  'rejected',
  'cancelled',
  'refunded',
  'charged_back'
]);

const CONFIRMED_PAYMENT_STATUS = 'approved';

module.exports = {
  PRODUCT,
  TERMINAL_PAYMENT_STATUSES,
  CONFIRMED_PAYMENT_STATUS
};
