export function required(name) {
  const value = process.env[name];
  if (!value) {
    const error = new Error(`Variavel de ambiente ausente: ${name}`);
    error.code = 'MISSING_ENV';
    throw error;
  }
  return value;
}

export function optional(name, fallback = undefined) {
  return process.env[name] || fallback;
}

export function publicConfig() {
  return {
    mercadoPagoPublicKey: required('MERCADOPAGO_PUBLIC_KEY')
  };
}

export function serverConfig() {
  return {
    appBaseUrl: required('APP_BASE_URL').replace(/\/$/, ''),
    mercadoPagoAccessToken: required('MERCADOPAGO_ACCESS_TOKEN'),
    mercadoPagoWebhookSecret: optional('MERCADOPAGO_WEBHOOK_SECRET'),
    databaseUrl: required('DATABASE_URL'),
    productAccessUrl: required('PRODUCT_ACCESS_URL'),
    cronSecret: required('CRON_SECRET')
  };
}

export function smtpConfig() {
  return {
    host: required('SMTP_HOST'),
    port: Number(required('SMTP_PORT')),
    secure: String(required('SMTP_SECURE')).toLowerCase() === 'true',
    user: required('SMTP_USER'),
    password: required('SMTP_PASSWORD'),
    from: required('EMAIL_FROM'),
    replyTo: optional('EMAIL_REPLY_TO')
  };
}
