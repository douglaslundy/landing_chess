import { query } from './db.js';
import { encryptValue, decryptValue } from './settingsCrypto.js';
import { required, optional } from './env.js';

const SETTING_DEFS = {
  product_title: { encrypted: false },
  product_description: { encrypted: false },
  product_amount_cents: { encrypted: false },
  product_currency: { encrypted: false },
  mercadopago_public_key: { encrypted: false },
  mercadopago_access_token: { encrypted: true, masked: true },
  mercadopago_webhook_secret: { encrypted: true, masked: true },
  smtp_host: { encrypted: false },
  smtp_port: { encrypted: false },
  smtp_secure: { encrypted: false },
  smtp_user: { encrypted: false },
  smtp_password: { encrypted: true, masked: true },
  email_from: { encrypted: false },
  email_reply_to: { encrypted: false },
  // Stored encrypted (protects it in a DB dump/backup), but not masked in
  // the admin UI: only an already-authenticated admin ever sees this
  // response, and unlike a payment credential there's no value in hiding
  // it from the one person allowed to read/edit it.
  product_access_url: { encrypted: true, masked: false }
};

export function isEncryptedSetting(key) {
  return Boolean(SETTING_DEFS[key]?.encrypted);
}

export function isMaskedSetting(key) {
  return Boolean(SETTING_DEFS[key]?.masked);
}

export async function getSetting(key) {
  const result = await query('select value, encrypted from settings where key = $1', [key]);
  const row = result.rows[0];
  if (!row) return null;
  return row.encrypted ? decryptValue(row.value) : row.value;
}

export async function setSetting(key, value) {
  const def = SETTING_DEFS[key];
  if (!def) throw new Error(`Configuração desconhecida: ${key}`);
  const storedValue = def.encrypted ? encryptValue(value) : String(value);
  await query(
    `insert into settings (key, value, encrypted, updated_at)
     values ($1, $2, $3, now())
     on conflict (key) do update set value = excluded.value, encrypted = excluded.encrypted, updated_at = now()`,
    [key, storedValue, def.encrypted]
  );
}

export async function getAllSettingsForAdmin() {
  const result = await query('select key, value, encrypted from settings', []);
  const rows = new Map(result.rows.map((row) => [row.key, row]));
  const output = {};
  for (const [key, def] of Object.entries(SETTING_DEFS)) {
    const row = rows.get(key);
    if (def.masked) {
      output[key] = { configured: Boolean(row) };
    } else if (def.encrypted) {
      output[key] = row ? decryptValue(row.value) : null;
    } else {
      output[key] = row ? row.value : null;
    }
  }
  return output;
}

export async function getProductSettings() {
  const [title, description, amountCents, currency] = await Promise.all([
    getSetting('product_title'),
    getSetting('product_description'),
    getSetting('product_amount_cents'),
    getSetting('product_currency')
  ]);
  return {
    code: 'xadrez-essencial-pdf',
    title: title || 'Xadrez Essencial',
    description: description || 'Livro digital Xadrez Essencial, 10 volumes em PDF',
    amountCents: Number(amountCents || 3990),
    currency: currency || 'BRL'
  };
}

export async function getMercadoPagoSettings() {
  const [publicKey, accessToken, webhookSecret] = await Promise.all([
    getSetting('mercadopago_public_key'),
    getSetting('mercadopago_access_token'),
    getSetting('mercadopago_webhook_secret')
  ]);
  return {
    get publicKey() {
      return publicKey || required('MERCADOPAGO_PUBLIC_KEY');
    },
    get accessToken() {
      return accessToken || required('MERCADOPAGO_ACCESS_TOKEN');
    },
    get webhookSecret() {
      return webhookSecret || optional('MERCADOPAGO_WEBHOOK_SECRET');
    }
  };
}

export async function getSmtpSettings() {
  const [host, port, secure, user, password, from, replyTo] = await Promise.all([
    getSetting('smtp_host'),
    getSetting('smtp_port'),
    getSetting('smtp_secure'),
    getSetting('smtp_user'),
    getSetting('smtp_password'),
    getSetting('email_from'),
    getSetting('email_reply_to')
  ]);
  return {
    host: host || required('SMTP_HOST'),
    port: Number(port || required('SMTP_PORT')),
    secure: secure !== null ? secure === 'true' : String(required('SMTP_SECURE')).toLowerCase() === 'true',
    user: user || required('SMTP_USER'),
    password: password || required('SMTP_PASSWORD'),
    from: from || required('EMAIL_FROM'),
    replyTo: replyTo || optional('EMAIL_REPLY_TO')
  };
}

export async function getProductAccessUrl() {
  const url = await getSetting('product_access_url');
  return url || required('PRODUCT_ACCESS_URL');
}
