import { query } from './db.js';
import { encryptValue, decryptValue } from './settingsCrypto.js';

const SETTING_DEFS = {
  product_title: { encrypted: false },
  product_description: { encrypted: false },
  product_amount_cents: { encrypted: false },
  product_currency: { encrypted: false },
  mercadopago_public_key: { encrypted: false },
  mercadopago_access_token: { encrypted: true },
  mercadopago_webhook_secret: { encrypted: true },
  smtp_host: { encrypted: false },
  smtp_port: { encrypted: false },
  smtp_secure: { encrypted: false },
  smtp_user: { encrypted: false },
  smtp_password: { encrypted: true },
  email_from: { encrypted: false },
  email_reply_to: { encrypted: false },
  product_access_url: { encrypted: true }
};

export function isEncryptedSetting(key) {
  return Boolean(SETTING_DEFS[key]?.encrypted);
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
    if (def.encrypted) {
      output[key] = { configured: Boolean(row) };
    } else {
      output[key] = row ? row.value : null;
    }
  }
  return output;
}
