# Fase 5 — Configurações gerais + Dashboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move product info, Mercado Pago credentials, SMTP credentials, and the product access URL from `.env`-only into a DB-backed, admin-editable `settings` table (secrets encrypted at rest), with `.env` as a transitional fallback — and add a read-only sales dashboard to `/admin`.

**Architecture:** A new `web/lib/settings.js` module is the single access point for the `settings` table (AES-256-GCM encryption for secret fields via `web/lib/settingsCrypto.js`). Existing Fase 2 checkout/payment/email code is refactored to read from this module (or, where a value is already snapshotted per-order in the `orders` table, from the order itself) instead of `web/lib/constants.js`'s `PRODUCT` or `web/lib/env.js`'s `serverConfig()`/`smtpConfig()` for the fields that move. `DATABASE_URL`, `APP_BASE_URL`, `CRON_SECRET`, and the new `SETTINGS_ENCRYPTION_KEY` stay `.env`-only (bootstrap/circularity reasons, explained in the spec).

**Tech Stack:** Next.js 15, `pg`, Zod, `node:crypto` (AES-256-GCM — no new dependency), `vitest`.

**Spec:** `docs/superpowers/specs/2026-09-16-fase5-settings-dashboard-design.md`

## Global Constraints

- No new npm dependencies.
- `settings.encrypted = true` rows store `iv:authTag:ciphertext` (hex, AES-256-GCM) — never plaintext.
- `GET /api/admin/settings` never returns a decrypted secret value to the browser — encrypted keys return `{ configured: boolean }` only.
- `PATCH /api/admin/settings`: an omitted or empty-string value for an **encrypted** key means "keep the current value" (never overwrite a real secret with blank). Non-encrypted keys are written as submitted, including empty string where the schema allows it (e.g. `email_reply_to`).
- `DATABASE_URL`, `APP_BASE_URL`, `CRON_SECRET`, `SETTINGS_ENCRYPTION_KEY` are never read from or written to the `settings` table — `.env` only.
- Every admin settings route requires `resolveSession(token, 'admin')` and calls `logAdminAction` on every successful write, matching the established Fase 3/4 pattern.
- Route Handlers and pages are NOT unit tested directly in this codebase (confirmed convention) — only `web/lib/**` and Zod schemas get dedicated tests. `acceptance-coverage.test.mjs`'s protection assertions use the **per-handler occurrence count** pattern established in Fase 4's fix wave (`.match(/resolveSession/g)?.length` compared with `toBeGreaterThanOrEqual`, accounting for the import line itself counting as one match), not a bare `.toContain`.
- Checkout must keep working exactly as before this phase while Mercado Pago/SMTP settings are unconfigured in the DB (env fallback, no regression).

---

### Task 1: Migration `004_settings.sql`

**Files:**
- Create: `migrations/004_settings.sql`

**Interfaces:**
- Produces: table `settings`; new column `orders.product_description` — consumed by Task 3 (`web/lib/settings.js`) and Task 7 (`web/lib/orders.js`).

- [ ] **Step 1: Write the migration file**

```sql
create table settings (
  key text primary key,
  value text not null,
  encrypted boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table orders add column product_description text;

insert into settings (key, value, encrypted) values
  ('product_title', 'Xadrez Essencial', false),
  ('product_description', 'Livro digital Xadrez Essencial, 10 volumes em PDF', false),
  ('product_amount_cents', '3990', false),
  ('product_currency', 'BRL', false);
```

- [ ] **Step 2: Commit**

```bash
git add migrations/004_settings.sql
git commit -m "feat(db): add settings table and orders.product_description, seed product settings"
```

---

### Task 2: `web/lib/settingsCrypto.js` — AES-256-GCM encrypt/decrypt

**Files:**
- Create: `web/lib/settingsCrypto.js`
- Test: `web/tests/settingsCrypto.test.mjs`

**Interfaces:**
- Consumes: `required` from `web/lib/env.js`.
- Produces: `encryptValue(plaintext: string): string`, `decryptValue(stored: string): string` —
  consumed by Task 3 (`web/lib/settings.js`).

- [ ] **Step 1: Write the failing test**

```js
import { afterEach, describe, expect, it } from 'vitest';
import { encryptValue, decryptValue } from '../lib/settingsCrypto.js';

const VALID_KEY = Buffer.alloc(32, 7).toString('base64');

describe('settingsCrypto', () => {
  afterEach(() => {
    delete process.env.SETTINGS_ENCRYPTION_KEY;
  });

  it('round-trips a value through encrypt/decrypt', () => {
    process.env.SETTINGS_ENCRYPTION_KEY = VALID_KEY;
    const encrypted = encryptValue('super-secret-token');
    expect(encrypted).not.toContain('super-secret-token');
    expect(decryptValue(encrypted)).toBe('super-secret-token');
  });

  it('produces a different ciphertext each time (random iv)', () => {
    process.env.SETTINGS_ENCRYPTION_KEY = VALID_KEY;
    const a = encryptValue('same value');
    const b = encryptValue('same value');
    expect(a).not.toBe(b);
  });

  it('throws when the encryption key is missing', () => {
    expect(() => encryptValue('x')).toThrow();
  });

  it('throws when the encryption key is not 32 bytes', () => {
    process.env.SETTINGS_ENCRYPTION_KEY = Buffer.alloc(16, 1).toString('base64');
    expect(() => encryptValue('x')).toThrow('32 bytes');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run tests/settingsCrypto.test.mjs`
Expected: FAIL — `Cannot find module '../lib/settingsCrypto.js'`

- [ ] **Step 3: Write the implementation**

```js
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { required } from './env.js';

function getKey() {
  const key = Buffer.from(required('SETTINGS_ENCRYPTION_KEY'), 'base64');
  if (key.length !== 32) {
    throw new Error('SETTINGS_ENCRYPTION_KEY deve ter 32 bytes (base64)');
  }
  return key;
}

export function encryptValue(plaintext) {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext.toString('hex')}`;
}

export function decryptValue(stored) {
  const [ivHex, tagHex, dataHex] = String(stored).split(':');
  const key = getKey();
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(tagHex, 'hex');
  const ciphertext = Buffer.from(dataHex, 'hex');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run tests/settingsCrypto.test.mjs`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add web/lib/settingsCrypto.js web/tests/settingsCrypto.test.mjs
git commit -m "feat(web): add AES-256-GCM encrypt/decrypt for settings values"
```

---

### Task 3: `web/lib/settings.js` — core store (`getSetting`/`setSetting`/`getAllSettingsForAdmin`)

**Files:**
- Create: `web/lib/settings.js`
- Test: `web/tests/settings.test.mjs`

**Interfaces:**
- Consumes: `query` (`web/lib/db.js`), `encryptValue`/`decryptValue` (`web/lib/settingsCrypto.js`, Task 2).
- Produces: `getSetting(key: string): Promise<string|null>`,
  `setSetting(key: string, value: string): Promise<void>`,
  `getAllSettingsForAdmin(): Promise<Record<string, string|null|{configured:boolean}>>`,
  `isEncryptedSetting(key: string): boolean` — all consumed by Task 4 (grouped getters) and Task 12 (admin settings route).
  Internally defines the fixed map of known setting keys → encrypted flag (`SETTING_DEFS`), not exported directly.

- [ ] **Step 1: Write the failing test**

```js
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();

vi.mock('pg', () => ({
  Pool: vi.fn().mockImplementation(function PoolMock() {
    return { query: queryMock };
  })
}));

const VALID_KEY = Buffer.alloc(32, 7).toString('base64');

const { resetPoolForTests } = await import('../lib/db.js');
const { encryptValue } = await import('../lib/settingsCrypto.js');
const { getSetting, setSetting, getAllSettingsForAdmin, isEncryptedSetting } = await import('../lib/settings.js');

describe('settings store', () => {
  beforeEach(() => {
    process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
    process.env.SETTINGS_ENCRYPTION_KEY = VALID_KEY;
    resetPoolForTests();
    queryMock.mockReset();
  });

  afterEach(() => {
    delete process.env.DATABASE_URL;
    delete process.env.SETTINGS_ENCRYPTION_KEY;
  });

  it('returns null when a setting has no row', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    await expect(getSetting('product_title')).resolves.toBeNull();
  });

  it('returns the plain value for a non-encrypted setting', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ value: 'Xadrez Essencial', encrypted: false }] });
    await expect(getSetting('product_title')).resolves.toBe('Xadrez Essencial');
  });

  it('decrypts the value for an encrypted setting', async () => {
    const stored = encryptValue('secret-token');
    queryMock.mockResolvedValueOnce({ rows: [{ value: stored, encrypted: true }] });
    await expect(getSetting('mercadopago_access_token')).resolves.toBe('secret-token');
  });

  it('encrypts a value before storing it when the key is marked encrypted', async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    await setSetting('smtp_password', 'my-password');
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toContain('insert into settings');
    expect(params[0]).toBe('smtp_password');
    expect(params[1]).not.toBe('my-password');
    expect(params[2]).toBe(true);
  });

  it('stores a plain value as-is when the key is not encrypted', async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    await setSetting('product_title', 'Novo título');
    const [, params] = queryMock.mock.calls[0];
    expect(params).toEqual(['product_title', 'Novo título', false]);
  });

  it('rejects an unknown setting key', async () => {
    await expect(setSetting('not_a_real_key', 'x')).rejects.toThrow();
  });

  it('reports whether a key is defined as encrypted', () => {
    expect(isEncryptedSetting('smtp_password')).toBe(true);
    expect(isEncryptedSetting('product_title')).toBe(false);
  });

  it('getAllSettingsForAdmin masks encrypted fields as configured booleans', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        { key: 'product_title', value: 'Xadrez Essencial', encrypted: false },
        { key: 'mercadopago_access_token', value: 'iv:tag:data', encrypted: true }
      ]
    });
    const settings = await getAllSettingsForAdmin();
    expect(settings.product_title).toBe('Xadrez Essencial');
    expect(settings.mercadopago_access_token).toEqual({ configured: true });
    expect(settings.mercadopago_webhook_secret).toEqual({ configured: false });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run tests/settings.test.mjs`
Expected: FAIL — `Cannot find module '../lib/settings.js'`

- [ ] **Step 3: Write the implementation**

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run tests/settings.test.mjs`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add web/lib/settings.js web/tests/settings.test.mjs
git commit -m "feat(web): add settings store (get/set/list for admin, encryption-aware)"
```

---

### Task 4: `web/lib/settings.js` — grouped getters with `.env` fallback

**Files:**
- Modify: `web/lib/settings.js`
- Modify: `web/tests/settings.test.mjs`

**Interfaces:**
- Consumes: `getSetting` (same file, Task 3), `required`/`optional` (`web/lib/env.js`),
  `PRODUCT_CODE` (`web/lib/constants.js` — added in Task 7, but this task only needs the
  string literal `'xadrez-essencial-pdf'`, written inline here to avoid a forward
  dependency on Task 7; Task 7 later imports it from constants.js instead of
  redefining it, once `PRODUCT_CODE` exists there).
- Produces: `getProductSettings(): Promise<{code,title,description,amountCents,currency}>`,
  `getMercadoPagoSettings(): Promise<{publicKey,accessToken,webhookSecret}>`,
  `getSmtpSettings(): Promise<{host,port,secure,user,password,from,replyTo}>`,
  `getProductAccessUrl(): Promise<string>` — consumed by Tasks 7-11.

- [ ] **Step 1: Write the failing tests**

Append to `web/tests/settings.test.mjs` (new `describe` block, same file):

```js
describe('grouped settings getters (DB-first, env fallback)', () => {
  beforeEach(() => {
    process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
    process.env.SETTINGS_ENCRYPTION_KEY = VALID_KEY;
    resetPoolForTests();
    queryMock.mockReset();
  });

  afterEach(() => {
    delete process.env.DATABASE_URL;
    delete process.env.SETTINGS_ENCRYPTION_KEY;
    delete process.env.MERCADOPAGO_PUBLIC_KEY;
    delete process.env.MERCADOPAGO_ACCESS_TOKEN;
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_SECURE;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASSWORD;
    delete process.env.EMAIL_FROM;
    delete process.env.PRODUCT_ACCESS_URL;
  });

  it('getProductSettings reads all four fields from the DB', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ value: 'Xadrez Essencial', encrypted: false }] })
      .mockResolvedValueOnce({ rows: [{ value: 'Descrição', encrypted: false }] })
      .mockResolvedValueOnce({ rows: [{ value: '4990', encrypted: false }] })
      .mockResolvedValueOnce({ rows: [{ value: 'BRL', encrypted: false }] });

    const { getProductSettings } = await import('../lib/settings.js');
    const product = await getProductSettings();

    expect(product).toEqual({
      code: 'xadrez-essencial-pdf',
      title: 'Xadrez Essencial',
      description: 'Descrição',
      amountCents: 4990,
      currency: 'BRL'
    });
  });

  it('getMercadoPagoSettings falls back to env vars when the DB has no rows', async () => {
    process.env.MERCADOPAGO_PUBLIC_KEY = 'TEST-public';
    process.env.MERCADOPAGO_ACCESS_TOKEN = 'TEST-token';
    queryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const { getMercadoPagoSettings } = await import('../lib/settings.js');
    const mp = await getMercadoPagoSettings();

    expect(mp).toEqual({ publicKey: 'TEST-public', accessToken: 'TEST-token', webhookSecret: undefined });
  });

  it('getSmtpSettings falls back to env vars when the DB has no rows', async () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_PORT = '587';
    process.env.SMTP_SECURE = 'false';
    process.env.SMTP_USER = 'user@example.com';
    process.env.SMTP_PASSWORD = 'env-password';
    process.env.EMAIL_FROM = 'from@example.com';
    queryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const { getSmtpSettings } = await import('../lib/settings.js');
    const smtp = await getSmtpSettings();

    expect(smtp.host).toBe('smtp.example.com');
    expect(smtp.port).toBe(587);
    expect(smtp.secure).toBe(false);
    expect(smtp.password).toBe('env-password');
  });

  it('getProductAccessUrl falls back to env when the DB has no row', async () => {
    process.env.PRODUCT_ACCESS_URL = 'https://produto.example/acesso';
    queryMock.mockResolvedValueOnce({ rows: [] });

    const { getProductAccessUrl } = await import('../lib/settings.js');
    await expect(getProductAccessUrl()).resolves.toBe('https://produto.example/acesso');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run tests/settings.test.mjs`
Expected: FAIL — the 4 new grouped getters aren't exported yet

- [ ] **Step 3: Add the grouped getters**

Append to `web/lib/settings.js` (add `import { required, optional } from './env.js';` to the top imports):

```js
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
    publicKey: publicKey || required('MERCADOPAGO_PUBLIC_KEY'),
    accessToken: accessToken || required('MERCADOPAGO_ACCESS_TOKEN'),
    webhookSecret: webhookSecret || optional('MERCADOPAGO_WEBHOOK_SECRET')
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run tests/settings.test.mjs`
Expected: PASS (12 tests total in the file)

- [ ] **Step 5: Commit**

```bash
git add web/lib/settings.js web/tests/settings.test.mjs
git commit -m "feat(web): add DB-first-with-env-fallback grouped settings getters"
```

---

### Task 5: `settingsUpdateSchema`

**Files:**
- Modify: `web/lib/schemas.js`
- Test: `web/tests/settings-schema.test.mjs`

**Interfaces:**
- Produces: `settingsUpdateSchema` (Zod, all fields optional/partial) — consumed by Task 12.

- [ ] **Step 1: Write the failing test**

```js
import { describe, expect, it } from 'vitest';
import { settingsUpdateSchema } from '../lib/schemas.js';

describe('settingsUpdateSchema', () => {
  it('accepts a partial update with just one field', () => {
    const parsed = settingsUpdateSchema.parse({ product_title: 'Novo título' });
    expect(parsed).toEqual({ product_title: 'Novo título' });
  });

  it('accepts an empty object (no fields changed)', () => {
    expect(settingsUpdateSchema.parse({})).toEqual({});
  });

  it('rejects an invalid product_access_url scheme', () => {
    expect(() => settingsUpdateSchema.parse({ product_access_url: 'javascript:alert(1)' })).toThrow();
  });

  it('coerces smtp_port to a number', () => {
    const parsed = settingsUpdateSchema.parse({ smtp_port: '587' });
    expect(parsed.smtp_port).toBe(587);
  });

  it('rejects an invalid email_from', () => {
    expect(() => settingsUpdateSchema.parse({ email_from: 'not-an-email' })).toThrow();
  });

  it('allows email_reply_to to be cleared to an empty string', () => {
    const parsed = settingsUpdateSchema.parse({ email_reply_to: '' });
    expect(parsed.email_reply_to).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run tests/settings-schema.test.mjs`
Expected: FAIL — `settingsUpdateSchema` not exported yet

- [ ] **Step 3: Add the schema**

Append to `web/lib/schemas.js`:

```js
export const settingsUpdateSchema = z.object({
  product_title: z.string().trim().min(1).max(200),
  product_description: z.string().trim().max(2000),
  product_amount_cents: z.coerce.number().int().positive(),
  product_currency: z.string().trim().length(3),
  mercadopago_public_key: z.string().trim().max(500),
  mercadopago_access_token: z.string().trim().max(500),
  mercadopago_webhook_secret: z.string().trim().max(500),
  smtp_host: z.string().trim().max(255),
  smtp_port: z.coerce.number().int().min(1).max(65535),
  smtp_secure: z.boolean(),
  smtp_user: z.string().trim().max(255),
  smtp_password: z.string().trim().max(500),
  email_from: z.string().trim().email().max(255),
  email_reply_to: z.string().trim().email().max(255).or(z.literal('')),
  product_access_url: z.string().trim().max(2000).refine(
    (value) => value === '' || /^https?:\/\//i.test(value),
    { message: 'URL deve começar com http:// ou https://' }
  )
}).partial();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run tests/settings-schema.test.mjs`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add web/lib/schemas.js web/tests/settings-schema.test.mjs
git commit -m "feat(web): add settings update validation schema"
```

---

### Task 6: `web/lib/dashboard.js` — sales stats

**Files:**
- Create: `web/lib/dashboard.js`
- Test: `web/tests/dashboard.test.mjs`

**Interfaces:**
- Consumes: `query` (`web/lib/db.js`).
- Produces: `getDashboardStats(): Promise<{paidOrders, totalRevenueCents, ordersByStatus, recentOrders}>` —
  consumed by Task 14 (`/admin` page).

- [ ] **Step 1: Write the failing test**

```js
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();

vi.mock('pg', () => ({
  Pool: vi.fn().mockImplementation(function PoolMock() {
    return { query: queryMock };
  })
}));

const { resetPoolForTests } = await import('../lib/db.js');
const { getDashboardStats } = await import('../lib/dashboard.js');

describe('dashboard stats', () => {
  beforeEach(() => {
    process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
    resetPoolForTests();
    queryMock.mockReset();
  });

  afterEach(() => {
    delete process.env.DATABASE_URL;
  });

  it('aggregates paid order count, revenue, status breakdown, and recent orders', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ count: 5, revenue_cents: 19950 }] })
      .mockResolvedValueOnce({ rows: [{ status: 'paid', count: 5 }, { status: 'pending', count: 2 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'o1', buyer_name: 'Douglas' }] });

    const stats = await getDashboardStats();

    expect(stats.paidOrders).toBe(5);
    expect(stats.totalRevenueCents).toBe(19950);
    expect(stats.ordersByStatus).toEqual({ paid: 5, pending: 2 });
    expect(stats.recentOrders).toEqual([{ id: 'o1', buyer_name: 'Douglas' }]);
  });

  it('returns zero totals when there are no orders', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ count: 0, revenue_cents: 0 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const stats = await getDashboardStats();

    expect(stats.paidOrders).toBe(0);
    expect(stats.totalRevenueCents).toBe(0);
    expect(stats.ordersByStatus).toEqual({});
    expect(stats.recentOrders).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run tests/dashboard.test.mjs`
Expected: FAIL — `Cannot find module '../lib/dashboard.js'`

- [ ] **Step 3: Write the implementation**

```js
import { query } from './db.js';

export async function getDashboardStats() {
  const [totals, byStatus, recent] = await Promise.all([
    query(
      `select count(*)::int as count, coalesce(sum(amount_cents), 0)::int as revenue_cents
       from orders where status = 'paid'`,
      []
    ),
    query('select status, count(*)::int as count from orders group by status', []),
    query(
      `select id, public_token, buyer_name, buyer_email, product_title, amount_cents, currency, status, created_at
       from orders order by created_at desc limit 20`,
      []
    )
  ]);

  return {
    paidOrders: totals.rows[0].count,
    totalRevenueCents: totals.rows[0].revenue_cents,
    ordersByStatus: byStatus.rows.reduce((acc, row) => {
      acc[row.status] = row.count;
      return acc;
    }, {}),
    recentOrders: recent.rows
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run tests/dashboard.test.mjs`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add web/lib/dashboard.js web/tests/dashboard.test.mjs
git commit -m "feat(web): add dashboard sales stats"
```

---

### Task 7: Refactor `web/lib/orders.js` to use settings

**Files:**
- Modify: `web/lib/orders.js`
- Modify: `web/tests/security.test.mjs`

**Interfaces:**
- Consumes: `getProductSettings` (`web/lib/settings.js`, Task 4).
- Produces: no change to `orders.js`'s exported function names/signatures.

**Important — do NOT touch `web/lib/constants.js` in this task.** `web/lib/email.js`
still imports `PRODUCT` from it until Task 9, and `web/tests/email.test.mjs` imports
`buildEmail` from `email.js` directly — removing `PRODUCT` now would break that test
(and any other untouched consumer) before Task 9 lands. `web/lib/constants.js`'s
`PRODUCT` export is removed only in Task 9, once `email.js` (the last remaining
consumer after this task and Task 8) no longer needs it. This task's rewrite of
`orders.js` does not need anything from `constants.js` except the already-existing
`CONFIRMED_PAYMENT_STATUS` — it gets the product code from `getProductSettings()`'s
return value, not from a constant.

- [ ] **Step 1: Rewrite `web/lib/orders.js`**

Full file replacement:

```js
import crypto from 'node:crypto';
import { withTransaction, query } from './db.js';
import { CONFIRMED_PAYMENT_STATUS } from './constants.js';
import { getProductSettings } from './settings.js';

function uuid() {
  return crypto.randomUUID();
}

export async function createOrder({ buyerName, buyerEmail, documentType, documentNumber }) {
  const product = await getProductSettings();
  const result = await query(
    `
    insert into orders (
      id, public_token, product_code, product_title, product_description, amount_cents, currency,
      buyer_name, buyer_email, document_type, document_number, status
    )
    values ($1, $2, $3, $4, $5, $6, $7, $8, lower($9), $10, $11, 'created')
    returning *
    `,
    [
      uuid(),
      crypto.randomBytes(32).toString('hex'),
      product.code,
      product.title,
      product.description,
      product.amountCents,
      product.currency,
      buyerName,
      buyerEmail,
      documentType || null,
      documentNumber || null
    ]
  );
  return result.rows[0];
}

export async function getOrderByToken(token) {
  const result = await query(
    `
    select o.*,
      coalesce(e.status, 'not_queued') as email_status,
      e.sent_at as email_sent_at
    from orders o
    left join outbox_emails e on e.order_id = o.id
    where o.public_token = $1
    `,
    [token]
  );
  return result.rows[0] || null;
}

export async function getLatestAttempt(orderId) {
  const result = await query(
    `select * from payment_attempts where order_id = $1 order by created_at desc limit 1`,
    [orderId]
  );
  return result.rows[0] || null;
}

export async function getReusableAttempt(orderId, method) {
  const result = await query(
    `
    select * from payment_attempts
    where order_id = $1
      and method = $2
      and status in ('created', 'pending', 'in_process')
      and created_at > now() - interval '45 minutes'
    order by created_at desc
    limit 1
    `,
    [orderId, method]
  );
  return result.rows[0] || null;
}

export async function createAttempt(orderId, method) {
  const result = await query(
    `
    insert into payment_attempts (id, order_id, method, idempotency_key, status)
    values ($1, $2, $3, $4, 'created')
    returning *
    `,
    [uuid(), orderId, method, uuid()]
  );
  return result.rows[0];
}

export async function updateAttemptFromPayment(attemptId, payment) {
  const pix = payment.point_of_interaction?.transaction_data || {};
  const result = await query(
    `
    update payment_attempts set
      mp_payment_id = $2,
      status = $3,
      status_detail = $4,
      amount_cents = round(($5::numeric) * 100)::int,
      currency = $6,
      qr_code = $7,
      qr_code_base64 = $8,
      ticket_url = $9,
      expires_at = $10,
      raw_response = $11::jsonb,
      updated_at = now()
    where id = $1
    returning *
    `,
    [
      attemptId,
      String(payment.id),
      payment.status,
      payment.status_detail || null,
      String(payment.transaction_amount || 0),
      payment.currency_id || 'BRL',
      pix.qr_code || null,
      pix.qr_code_base64 || null,
      pix.ticket_url || null,
      payment.date_of_expiration || null,
      JSON.stringify(payment)
    ]
  );
  return result.rows[0];
}

function internalStatusForPayment(status) {
  if (status === CONFIRMED_PAYMENT_STATUS) return 'paid';
  if (status === 'rejected') return 'rejected';
  if (status === 'cancelled') return 'cancelled';
  if (status === 'refunded') return 'refunded';
  if (status === 'charged_back') return 'charged_back';
  if (status === 'in_process') return 'processing';
  return 'pending';
}

export async function applyOfficialPayment(payment) {
  return withTransaction(async (client) => {
    const orderId = payment.external_reference || payment.metadata?.order_id;
    if (!orderId) throw new Error('Pagamento sem external_reference/order_id');

    const orderResult = await client.query('select * from orders where id = $1 for update', [orderId]);
    const order = orderResult.rows[0];
    if (!order) throw new Error('Pedido local nao encontrado para pagamento oficial');

    const amountCents = Math.round(Number(payment.transaction_amount || 0) * 100);
    const receiverOk = !process.env.MERCADOPAGO_EXPECTED_COLLECTOR_ID ||
      String(payment.collector_id) === String(process.env.MERCADOPAGO_EXPECTED_COLLECTOR_ID);
    if (
      order.amount_cents !== amountCents ||
      order.currency !== payment.currency_id ||
      payment.metadata?.product_code !== order.product_code ||
      !receiverOk
    ) {
      await client.query(
        `insert into provider_events (id, order_id, mp_payment_id, type, payload)
         values ($1, $2, $3, 'payment_mismatch', $4::jsonb)`,
        [uuid(), order.id, String(payment.id), JSON.stringify(payment)]
      );
      throw new Error('Divergencia entre pedido local e pagamento oficial');
    }

    await client.query(
      `
      update payment_attempts set
        mp_payment_id = $2,
        status = $3,
        status_detail = $4,
        amount_cents = $5,
        currency = $6,
        raw_response = $7::jsonb,
        updated_at = now()
      where order_id = $1 and (mp_payment_id = $2 or id = $8)
      `,
      [
        order.id,
        String(payment.id),
        payment.status,
        payment.status_detail || null,
        amountCents,
        payment.currency_id,
        JSON.stringify(payment),
        payment.metadata?.attempt_id || null
      ]
    );

    const nextStatus = internalStatusForPayment(payment.status);
    const confirmed = payment.status === CONFIRMED_PAYMENT_STATUS;
    const orderUpdate = await client.query(
      `
      update orders set
        status = case
          when status = 'paid' and $2 <> 'refunded' and $2 <> 'charged_back' then status
          else $2
        end,
        payment_confirmed_at = case
          when $3::boolean and payment_confirmed_at is null then now()
          else payment_confirmed_at
        end,
        updated_at = now()
      where id = $1
      returning *
      `,
      [order.id, nextStatus, confirmed]
    );

    if (confirmed) {
      await client.query(
        `
        insert into outbox_emails (id, order_id, status, next_attempt_at)
        values ($1, $2, 'pending', now())
        on conflict (order_id) do nothing
        `,
        [uuid(), order.id]
      );
    }

    if (payment.status === 'refunded' || payment.status === 'charged_back') {
      await client.query(
        `
        insert into provider_events (id, order_id, mp_payment_id, type, payload)
        values ($1, $2, $3, $4, $5::jsonb)
        on conflict do nothing
        `,
        [uuid(), order.id, String(payment.id), payment.status, JSON.stringify(payment)]
      );
    }

    return orderUpdate.rows[0];
  });
}
```

Note on `updateAttemptFromPayment`'s `payment.currency_id || 'BRL'` fallback (was
`payment.currency_id || PRODUCT.currency`): this fallback only fires when Mercado
Pago's response omits `currency_id`, which doesn't happen in practice — hardcoding
`'BRL'` here (this business's only currency) is simpler and lower-risk than threading
`order` into this function just for a fallback branch that's never actually hit.

- [ ] **Step 2: Rewrite `web/tests/security.test.mjs`**

```js
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();

vi.mock('pg', () => ({
  Pool: vi.fn().mockImplementation(function PoolMock() {
    return { query: queryMock };
  })
}));

const { resetPoolForTests } = await import('../lib/db.js');
const { createOrderSchema, cardPaymentSchema } = await import('../lib/schemas.js');
const { getProductSettings } = await import('../lib/settings.js');

describe('checkout input validation', () => {
  beforeEach(() => {
    process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
    resetPoolForTests();
    queryMock.mockReset();
  });

  afterEach(() => {
    delete process.env.DATABASE_URL;
  });

  it('does not accept price or product values from the browser when creating orders', () => {
    const parsed = createOrderSchema.parse({
      buyerName: 'Douglas Lundy',
      buyerEmail: 'douglas@example.com',
      amountCents: 1,
      productCode: 'alterado'
    });

    expect(parsed.amountCents).toBeUndefined();
  });

  it('always reads the current price from settings, never from client input', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ value: 'Xadrez Essencial', encrypted: false }] })
      .mockResolvedValueOnce({ rows: [{ value: 'desc', encrypted: false }] })
      .mockResolvedValueOnce({ rows: [{ value: '3990', encrypted: false }] })
      .mockResolvedValueOnce({ rows: [{ value: 'BRL', encrypted: false }] });

    const product = await getProductSettings();
    expect(product.amountCents).toBe(3990);
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
```

- [ ] **Step 3: Run the full test suite**

Run: `cd web && npx vitest run`
Expected: all tests pass (Task 7's changes plus every earlier task). `web/lib/email.js`
still imports `PRODUCT` from `constants.js` at this point — that's fine and expected,
since Task 7 doesn't touch `constants.js` at all.

- [ ] **Step 4: Commit**

```bash
git add web/lib/orders.js web/tests/security.test.mjs
git commit -m "refactor(web): read product settings from DB in orders.js"
```

---

### Task 8: Refactor `web/lib/mercadopago.js` to use settings + order snapshot

**Files:**
- Modify: `web/lib/mercadopago.js`

**Interfaces:**
- Consumes: `getMercadoPagoSettings` (`web/lib/settings.js`, Task 4).
- Produces: no change to `createPayment`/`getPayment`/`searchPaymentsByExternalReference`'s
  exported signatures — same consumers (`web/app/api/payments/*`) call them unchanged.

- [ ] **Step 1: Rewrite `web/lib/mercadopago.js`**

Full file replacement:

```js
import { serverConfig } from './env.js';
import { getMercadoPagoSettings } from './settings.js';

export function amountFromCents(cents) {
  return Number((cents / 100).toFixed(2));
}

async function mercadoPagoRequest(path, options = {}) {
  const { accessToken } = await getMercadoPagoSettings();
  const response = await fetch(`https://api.mercadopago.com${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const error = new Error(`Mercado Pago retornou HTTP ${response.status}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

export async function createPayment({ order, attempt, payment }) {
  const { appBaseUrl } = serverConfig();
  const body = {
    transaction_amount: amountFromCents(order.amount_cents),
    description: order.product_description || order.product_title,
    external_reference: order.id,
    notification_url: `${appBaseUrl}/api/mercadopago/webhook`,
    metadata: {
      order_id: order.id,
      product_code: order.product_code,
      attempt_id: attempt.id
    },
    payer: {
      email: order.buyer_email,
      first_name: order.buyer_name,
      identification: order.document_type && order.document_number ? {
        type: order.document_type,
        number: order.document_number
      } : undefined
    },
    ...payment
  };

  return mercadoPagoRequest('/v1/payments', {
    method: 'POST',
    headers: { 'X-Idempotency-Key': attempt.idempotency_key },
    body: JSON.stringify(body)
  });
}

export function getPayment(paymentId) {
  return mercadoPagoRequest(`/v1/payments/${encodeURIComponent(paymentId)}`);
}

export function searchPaymentsByExternalReference(orderId) {
  return mercadoPagoRequest(`/v1/payments/search?external_reference=${encodeURIComponent(orderId)}`);
}
```

No dedicated test file exists for this module today (verified — none of the current
`web/tests/*` target it); this task doesn't add one, consistent with the current
state (it's exercised indirectly by whatever manual/integration checks already cover
the payment routes).

- [ ] **Step 2: Run the full test suite**

Run: `cd web && npx vitest run`
Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add web/lib/mercadopago.js
git commit -m "refactor(web): read Mercado Pago access token from settings, order fields instead of PRODUCT"
```

---

### Task 9: Refactor `web/lib/email.js` to use settings, remove unused `PRODUCT` constant

**Files:**
- Modify: `web/lib/email.js`
- Modify: `web/lib/constants.js`
- Modify: `web/tests/email.test.mjs`

**Interfaces:**
- Consumes: `getSmtpSettings`, `getProductAccessUrl` (`web/lib/settings.js`, Task 4).
- Produces: `buildEmail(order, {magicLinkUrl, productAccessUrl}?)` — signature change from
  Fase 3's `buildEmail(order, magicLinkUrl)`; the only callers are inside this same file
  (`processEmailOutbox`) and the test file, both updated in this task. `sendMagicLinkEmail`
  and `processEmailOutbox` keep their existing exported signatures. `web/lib/constants.js`
  no longer exports `PRODUCT` after this task (Tasks 7 and 8 already stopped using it;
  this is the last consumer, so removal is safe only once this task's rewrite lands).

- [ ] **Step 1: Rewrite `web/lib/email.js`**

Full file replacement:

```js
import nodemailer from 'nodemailer';
import { serverConfig } from './env.js';
import { getSmtpSettings, getProductAccessUrl } from './settings.js';
import { withTransaction, query } from './db.js';
import { MAGIC_LINK_TTL_SECONDS } from './constants.js';
import { createMagicLink } from './auth/magicLink.js';

async function createTransporter() {
  const cfg = await getSmtpSettings();
  const mailer = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.password },
    requireTLS: !cfg.secure
  });
  return { mailer, cfg };
}

export function buildEmail(order, { magicLinkUrl, productAccessUrl } = {}) {
  const subject = 'Seu acesso ao Xadrez Essencial';
  const magicLinkText = magicLinkUrl
    ? `\n\nVocê também já pode entrar direto na área de aulas por aqui (link de uso único, válido por 30 minutos): ${magicLinkUrl}`
    : '';
  const text = [
    `Olá, ${order.buyer_name}.`,
    '',
    `Recebemos a confirmação do pagamento da compra ${order.id}.`,
    `Acesse o produto digital aqui: ${productAccessUrl}`,
    '',
    'Este link é fixo e pode ser compartilhado. Ele não é um controle individual de acesso.',
    '',
    'Douglas Lundy'
  ].join('\n') + magicLinkText;
  const magicLinkHtml = magicLinkUrl
    ? `<p><a href="${magicLinkUrl}">Entrar na área de aulas agora</a> (link de uso único, válido por 30 minutos).</p>`
    : '';
  const html = `
    <p>Olá, ${escapeHtml(order.buyer_name)}.</p>
    <p>Recebemos a confirmação do pagamento da compra <strong>${order.id}</strong>.</p>
    <p><a href="${productAccessUrl}" style="display:inline-block;background:#d10e17;color:#fff;padding:14px 18px;border-radius:8px;text-decoration:none;font-weight:700">Acessar ${escapeHtml(order.product_title)}</a></p>
    <p>Se o botão não abrir, use este link:<br><a href="${productAccessUrl}">${productAccessUrl}</a></p>
    ${magicLinkHtml}
    <p><small>Este link é fixo e pode ser compartilhado. Ele não é um controle individual de acesso.</small></p>
  `;
  return { subject, text, html };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[char]));
}

export async function processEmailOutbox(limit = 10) {
  const jobs = await withTransaction(async (client) => {
    const result = await client.query(
      `
      select e.*, o.buyer_name, o.buyer_email, o.product_title
      from outbox_emails e
      join orders o on o.id = e.order_id
      where e.status in ('pending', 'failed')
        and e.next_attempt_at <= now()
      order by e.created_at
      limit $1
      for update skip locked
      `,
      [limit]
    );
    const ids = result.rows.map((row) => row.id);
    if (ids.length) {
      await client.query(
        `update outbox_emails set status = 'sending', updated_at = now() where id = any($1::uuid[])`,
        [ids]
      );
    }
    return result.rows;
  });

  if (!jobs.length) return [];

  const { mailer, cfg } = await createTransporter();
  const { appBaseUrl } = serverConfig();
  const productAccessUrl = await getProductAccessUrl();

  const results = [];
  for (const job of jobs) {
    try {
      const magicLinkToken = await createMagicLink(job.buyer_email, MAGIC_LINK_TTL_SECONDS);
      const magicLinkUrl = `${appBaseUrl}/api/client/magic-link/consume?token=${magicLinkToken}`;
      const message = buildEmail(job, { magicLinkUrl, productAccessUrl });
      const info = await mailer.sendMail({
        from: cfg.from,
        to: job.buyer_email,
        replyTo: cfg.replyTo,
        subject: message.subject,
        text: message.text,
        html: message.html,
        headers: { 'X-Order-Id': job.order_id }
      });
      await query(
        `
        update outbox_emails set
          status = 'sent',
          attempts = attempts + 1,
          provider_message_id = $2,
          sent_at = now(),
          last_error = null,
          updated_at = now()
        where id = $1
        `,
        [job.id, info.messageId || null]
      );
      await query(
        `update orders set email_sent_at = now(), updated_at = now() where id = $1`,
        [job.order_id]
      );
      results.push({ id: job.id, status: 'sent' });
    } catch (error) {
      await query(
        `
        update outbox_emails set
          status = 'failed',
          attempts = attempts + 1,
          next_attempt_at = now() + ((least(attempts + 1, 6) * least(attempts + 1, 6)) * interval '5 minutes'),
          last_error = left($2, 500),
          updated_at = now()
        where id = $1
        `,
        [job.id, error.message]
      );
      results.push({ id: job.id, status: 'failed', error: error.message });
    }
  }
  return results;
}

export async function sendMagicLinkEmail(email, token) {
  const { mailer, cfg } = await createTransporter();
  const { appBaseUrl } = serverConfig();
  const url = `${appBaseUrl}/api/client/magic-link/consume?token=${token}`;
  await mailer.sendMail({
    from: cfg.from,
    to: email,
    replyTo: cfg.replyTo,
    subject: 'Seu link de acesso — Xadrez Essencial',
    text: `Use este link para entrar na sua área de aulas (válido por 30 minutos, uso único):\n${url}`,
    html: `<p>Use este link para entrar na sua área de aulas (válido por 30 minutos, uso único):</p><p><a href="${url}">${url}</a></p>`
  });
}
```

- [ ] **Step 2: Rewrite `web/tests/email.test.mjs`**

```js
import { describe, expect, it } from 'vitest';
import { buildEmail } from '../lib/email.js';

describe('delivery email', () => {
  it('renders html and text with the given product URL', () => {
    const email = buildEmail(
      { id: 'order-id', buyer_name: 'Douglas', product_title: 'Xadrez Essencial' },
      { productAccessUrl: 'https://produto.example/acesso' }
    );

    expect(email.subject).toContain('Xadrez Essencial');
    expect(email.text).toContain('https://produto.example/acesso');
    expect(email.html).toContain('https://produto.example/acesso');
  });

  it('includes the magic link when one is provided', () => {
    const email = buildEmail(
      { id: 'order-id', buyer_name: 'Douglas', product_title: 'Xadrez Essencial' },
      {
        magicLinkUrl: 'https://app.example/api/client/magic-link/consume?token=abc123',
        productAccessUrl: 'https://produto.example/acesso'
      }
    );

    expect(email.text).toContain('https://app.example/api/client/magic-link/consume?token=abc123');
    expect(email.html).toContain('https://app.example/api/client/magic-link/consume?token=abc123');
  });

  it('omits any magic-link mention when none is provided', () => {
    const email = buildEmail(
      { id: 'order-id', buyer_name: 'Douglas', product_title: 'Xadrez Essencial' },
      { productAccessUrl: 'https://produto.example/acesso' }
    );
    expect(email.text).not.toContain('magic-link');
    expect(email.html).not.toContain('magic-link');
  });

  it("uses the order's own product title, not a global constant", () => {
    const email = buildEmail(
      { id: 'order-id', buyer_name: 'Douglas', product_title: 'Nome Diferente' },
      { productAccessUrl: 'https://produto.example/acesso' }
    );
    expect(email.html).toContain('Nome Diferente');
  });
});
```

- [ ] **Step 3: Remove `PRODUCT` from `web/lib/constants.js`**

This is the last remaining consumer of `PRODUCT` (Task 7 already moved `orders.js`
off it without touching `constants.js`; Task 8 already moved `mercadopago.js` off
it) — safe to remove now. Rewrite `web/lib/constants.js` to:

```js
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
```

Before making this change, run `grep -rn "PRODUCT\b" web/lib web/app` (excluding
`node_modules`) to confirm no file other than `constants.js` itself still
references `PRODUCT` — if anything unexpected still does, stop and report back
rather than deleting the export out from under it.

- [ ] **Step 4: Run the full test suite**

Run: `cd web && npx vitest run`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add web/lib/email.js web/lib/constants.js web/tests/email.test.mjs
git commit -m "refactor(web): read SMTP config and product access URL from settings in email.js, drop unused PRODUCT constant"
```

---

### Task 10: Refactor `web/lib/http.js` + `web/app/api/orders/route.js`

**Files:**
- Modify: `web/lib/http.js`
- Modify: `web/app/api/orders/route.js`

**Interfaces:**
- Consumes: `getProductAccessUrl` (`web/lib/settings.js`, Task 4).
- Produces: `publicOrder(order, attempt)` becomes `async` — the only two call sites
  (both in `web/app/api/orders/route.js`) are updated in this same task.

- [ ] **Step 1: Update `web/lib/http.js`**

Add `import { getProductAccessUrl } from './settings.js';` to the top, and change
`publicOrder`:

```js
export async function publicOrder(order, attempt) {
  const accessUrl = order.status === 'paid' ? await getProductAccessUrl() : null;
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
    accessUrl
  };
}
```

(`getClientIp` above it in the same file is untouched.)

- [ ] **Step 2: Update `web/app/api/orders/route.js`**

Change `return NextResponse.json(publicOrder(order, attempt));` (in `GET`) to
`return NextResponse.json(await publicOrder(order, attempt));`, and
`return NextResponse.json(publicOrder(order, null), { status: 201 });` (in `POST`) to
`return NextResponse.json(await publicOrder(order, null), { status: 201 });`.

- [ ] **Step 3: Run the full test suite**

Run: `cd web && npx vitest run`
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add web/lib/http.js web/app/api/orders/route.js
git commit -m "refactor(web): make publicOrder async, read product access URL from settings"
```

---

### Task 11: Refactor `web/app/api/config/route.js`

**Files:**
- Modify: `web/app/api/config/route.js`

**Interfaces:**
- Consumes: `getMercadoPagoSettings`, `getProductSettings` (`web/lib/settings.js`, Task 4).
- Produces: same JSON response shape as before (`mercadoPagoPublicKey`, `product.title`,
  `product.amountCents`, `product.currency`, `polling`) — no change for the frontend
  `checkout.js` consumer.

- [ ] **Step 1: Rewrite the route**

```js
import { NextResponse } from 'next/server';
import { getMercadoPagoSettings, getProductSettings } from '../../../lib/settings.js';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const [mercadoPago, product] = await Promise.all([
      getMercadoPagoSettings(),
      getProductSettings()
    ]);
    return NextResponse.json({
      mercadoPagoPublicKey: mercadoPago.publicKey,
      product: {
        title: product.title,
        amountCents: product.amountCents,
        currency: product.currency
      },
      polling: {
        initialMs: 4000,
        inactiveMs: 15000
      }
    });
  } catch (error) {
    console.error('[api/config] failed:', error);
    return NextResponse.json({ error: error.code || 'configuration_error' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Run the full test suite**

Run: `cd web && npx vitest run`
Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add web/app/api/config/route.js
git commit -m "refactor(web): read public config from settings instead of env.js/constants.js"
```

---

### Task 12: Admin settings routes

**Files:**
- Create: `web/app/api/admin/settings/route.js`

**Interfaces:**
- Consumes: `resolveSession` (`web/lib/auth/guard.js`), `ADMIN_COOKIE` (`web/lib/auth/cookies.js`),
  `logAdminAction` (`web/lib/auth/accessLog.js`), `getClientIp` (`web/lib/http.js`),
  `settingsUpdateSchema` (`web/lib/schemas.js`, Task 5), `getAllSettingsForAdmin`,
  `setSetting`, `isEncryptedSetting` (`web/lib/settings.js`, Tasks 3-4).
- Produces: `GET /api/admin/settings` (`{ settings }`), `PATCH /api/admin/settings`
  (`{ settings }` after applying changes) — consumed by Task 13's admin UI.

No dedicated test file (route handlers aren't unit tested in this codebase — see
Global Constraints). Verified in Task 16.

- [ ] **Step 1: Create the route**

```js
import { NextResponse } from 'next/server';
import { getClientIp } from '../../../../lib/http.js';
import { resolveSession } from '../../../../lib/auth/guard.js';
import { logAdminAction } from '../../../../lib/auth/accessLog.js';
import { ADMIN_COOKIE } from '../../../../lib/auth/cookies.js';
import { settingsUpdateSchema } from '../../../../lib/schemas.js';
import { getAllSettingsForAdmin, setSetting, isEncryptedSetting } from '../../../../lib/settings.js';

export async function GET(request) {
  const token = request.cookies.get(ADMIN_COOKIE)?.value || null;
  const session = await resolveSession(token, 'admin');
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  try {
    const settings = await getAllSettingsForAdmin();
    return NextResponse.json({ settings });
  } catch (error) {
    console.error('[api/admin/settings GET] failed:', error);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}

export async function PATCH(request) {
  const token = request.cookies.get(ADMIN_COOKIE)?.value || null;
  const session = await resolveSession(token, 'admin');
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  try {
    let raw;
    try { raw = await request.json(); } catch { raw = {}; }
    const data = settingsUpdateSchema.parse(raw);

    const changedKeys = Object.keys(data).filter((key) => {
      if (data[key] === undefined) return false;
      if (isEncryptedSetting(key) && data[key] === '') return false;
      return true;
    });
    for (const key of changedKeys) {
      await setSetting(key, data[key]);
    }
    await logAdminAction(session.subject_id, 'update_settings', changedKeys.join(','), getClientIp(request));

    const settings = await getAllSettingsForAdmin();
    return NextResponse.json({ settings });
  } catch (error) {
    if (error.name === 'ZodError') {
      return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
    }
    console.error('[api/admin/settings PATCH] failed:', error);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Run the full test suite**

Run: `cd web && npx vitest run`
Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add web/app/api/admin/settings/route.js
git commit -m "feat(web): add admin settings GET/PATCH route"
```

---

### Task 13: Admin config UI

**Files:**
- Create: `web/app/admin/config/page.js`
- Create: `web/app/admin/config/ConfigManager.js`

**Interfaces:**
- Consumes: `resolveSession` (`web/lib/auth/guard.js`), `ADMIN_COOKIE` (`web/lib/auth/cookies.js`),
  `GET`/`PATCH /api/admin/settings` (Task 12).

No dedicated test (no React component testing tool configured, same as every other
admin page). Verified in Task 16.

- [ ] **Step 1: Create the config form client component**

`web/app/admin/config/ConfigManager.js`:

```jsx
'use client';
import { useEffect, useState } from 'react';

const EMPTY_FORM = {
  product_title: '',
  product_description: '',
  product_amount_cents: 0,
  product_currency: 'BRL',
  mercadopago_public_key: '',
  mercadopago_access_token: '',
  mercadopago_webhook_secret: '',
  smtp_host: '',
  smtp_port: 587,
  smtp_secure: false,
  smtp_user: '',
  smtp_password: '',
  email_from: '',
  email_reply_to: '',
  product_access_url: ''
};

const ENCRYPTED_KEYS = new Set([
  'mercadopago_access_token',
  'mercadopago_webhook_secret',
  'smtp_password',
  'product_access_url'
]);

export default function ConfigManager() {
  const [form, setForm] = useState(EMPTY_FORM);
  const [configured, setConfigured] = useState({});
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);

  async function loadSettings() {
    const response = await fetch('/api/admin/settings');
    if (!response.ok) return;
    const body = await response.json();
    const nextForm = { ...EMPTY_FORM };
    const nextConfigured = {};
    for (const [key, value] of Object.entries(body.settings)) {
      if (ENCRYPTED_KEYS.has(key)) {
        nextConfigured[key] = value?.configured || false;
      } else if (value !== null && value !== undefined) {
        nextForm[key] = value;
      }
    }
    setForm(nextForm);
    setConfigured(nextConfigured);
  }

  useEffect(() => {
    loadSettings();
  }, []);

  function updateField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    const payload = { ...form };
    for (const key of ENCRYPTED_KEYS) {
      if (!payload[key]) delete payload[key];
    }
    const response = await fetch('/api/admin/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      setError('Não foi possível salvar. Confira os campos.');
      return;
    }
    setMessage('Configurações salvas.');
    await loadSettings();
  }

  return (
    <main style={{ padding: 32, fontFamily: 'sans-serif', maxWidth: 720 }}>
      <h1>Configurações</h1>
      <form onSubmit={handleSubmit}>
        <h2>Produto</h2>
        <label>
          Título
          <input value={form.product_title} onChange={(e) => updateField('product_title', e.target.value)} required />
        </label>
        <label>
          Descrição
          <textarea value={form.product_description} onChange={(e) => updateField('product_description', e.target.value)} />
        </label>
        <label>
          Preço (em centavos, ex: 3990 = R$ 39,90)
          <input type="number" value={form.product_amount_cents} onChange={(e) => updateField('product_amount_cents', e.target.value)} required />
        </label>
        <label>
          Moeda
          <input value={form.product_currency} onChange={(e) => updateField('product_currency', e.target.value)} required />
        </label>

        <h2>Mercado Pago</h2>
        <label>
          Chave pública
          <input value={form.mercadopago_public_key} onChange={(e) => updateField('mercadopago_public_key', e.target.value)} />
        </label>
        <label>
          Access token {configured.mercadopago_access_token ? '(configurado ✓)' : '(não configurado)'}
          <input type="password" value={form.mercadopago_access_token} onChange={(e) => updateField('mercadopago_access_token', e.target.value)} placeholder="Deixe em branco para manter o atual" />
        </label>
        <label>
          Webhook secret {configured.mercadopago_webhook_secret ? '(configurado ✓)' : '(não configurado)'}
          <input type="password" value={form.mercadopago_webhook_secret} onChange={(e) => updateField('mercadopago_webhook_secret', e.target.value)} placeholder="Deixe em branco para manter o atual" />
        </label>

        <h2>E-mail (SMTP)</h2>
        <label>
          Host
          <input value={form.smtp_host} onChange={(e) => updateField('smtp_host', e.target.value)} />
        </label>
        <label>
          Porta
          <input type="number" value={form.smtp_port} onChange={(e) => updateField('smtp_port', e.target.value)} />
        </label>
        <label>
          <input type="checkbox" checked={form.smtp_secure} onChange={(e) => updateField('smtp_secure', e.target.checked)} />
          Conexão segura (TLS)
        </label>
        <label>
          Usuário
          <input value={form.smtp_user} onChange={(e) => updateField('smtp_user', e.target.value)} />
        </label>
        <label>
          Senha {configured.smtp_password ? '(configurada ✓)' : '(não configurada)'}
          <input type="password" value={form.smtp_password} onChange={(e) => updateField('smtp_password', e.target.value)} placeholder="Deixe em branco para manter a atual" />
        </label>
        <label>
          Remetente
          <input value={form.email_from} onChange={(e) => updateField('email_from', e.target.value)} />
        </label>
        <label>
          Responder para
          <input value={form.email_reply_to} onChange={(e) => updateField('email_reply_to', e.target.value)} />
        </label>

        <h2>Acesso ao produto</h2>
        <label>
          URL de acesso {configured.product_access_url ? '(configurada ✓)' : '(não configurada)'}
          <input type="password" value={form.product_access_url} onChange={(e) => updateField('product_access_url', e.target.value)} placeholder="Deixe em branco para manter a atual" />
        </label>

        {error && <p role="alert">{error}</p>}
        {message && <p>{message}</p>}
        <button type="submit">Salvar</button>
      </form>
    </main>
  );
}
```

- [ ] **Step 2: Create the protected page wrapper**

`web/app/admin/config/page.js`:

```jsx
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ADMIN_COOKIE } from '../../../lib/auth/cookies.js';
import { resolveSession } from '../../../lib/auth/guard.js';
import ConfigManager from './ConfigManager.js';

export default async function AdminConfigPage() {
  const jar = await cookies();
  const token = jar.get(ADMIN_COOKIE)?.value || null;
  const session = await resolveSession(token, 'admin');
  if (!session) redirect('/admin/login');

  return <ConfigManager />;
}
```

- [ ] **Step 3: Run the full test suite**

Run: `cd web && npx vitest run`
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add web/app/admin/config
git commit -m "feat(web): add admin settings/config CRUD page"
```

---

### Task 14: Dashboard on `/admin`

**Files:**
- Modify: `web/app/admin/page.js`

**Interfaces:**
- Consumes: `getDashboardStats` (`web/lib/dashboard.js`, Task 6).

- [ ] **Step 1: Rewrite `web/app/admin/page.js`**

Full file replacement:

```jsx
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ADMIN_COOKIE } from '../../lib/auth/cookies.js';
import { resolveSession } from '../../lib/auth/guard.js';
import { getDashboardStats } from '../../lib/dashboard.js';
import LogoutButton from '../components/LogoutButton.js';

export default async function AdminHomePage() {
  const jar = await cookies();
  const token = jar.get(ADMIN_COOKIE)?.value || null;
  const session = await resolveSession(token, 'admin');
  if (!session) redirect('/admin/login');

  const stats = await getDashboardStats();

  return (
    <main style={{ padding: 32, fontFamily: 'sans-serif' }}>
      <h1>Painel admin</h1>
      <p>
        <Link href="/admin/aulas">Gerenciar aulas</Link>
        {' · '}
        <Link href="/admin/config">Configurações</Link>
      </p>

      <h2>Vendas</h2>
      <p>Pedidos pagos: {stats.paidOrders}</p>
      <p>Receita total: R$ {(stats.totalRevenueCents / 100).toFixed(2)}</p>
      <ul>
        {Object.entries(stats.ordersByStatus).map(([status, count]) => (
          <li key={status}>{status}: {count}</li>
        ))}
      </ul>

      <h2>Pedidos recentes</h2>
      <table>
        <thead>
          <tr>
            <th>Cliente</th>
            <th>Produto</th>
            <th>Valor</th>
            <th>Status</th>
            <th>Data</th>
          </tr>
        </thead>
        <tbody>
          {stats.recentOrders.map((order) => (
            <tr key={order.id}>
              <td>{order.buyer_name}</td>
              <td>{order.product_title}</td>
              <td>R$ {(order.amount_cents / 100).toFixed(2)}</td>
              <td>{order.status}</td>
              <td>{new Date(order.created_at).toLocaleDateString('pt-BR')}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <LogoutButton endpoint="/api/admin/logout" redirectTo="/admin/login" />
    </main>
  );
}
```

- [ ] **Step 2: Run the full test suite**

Run: `cd web && npx vitest run`
Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add web/app/admin/page.js
git commit -m "feat(web): add sales dashboard to /admin"
```

---

### Task 15: Extend the route-protection test safety net

**Files:**
- Modify: `web/tests/acceptance-coverage.test.mjs`

**Interfaces:**
- No new interfaces — extends the existing `'auth route protection safeguards'`
  describe block (Fase 4's fix wave already corrected its pattern to per-handler
  occurrence counts).

- [ ] **Step 1: Add the settings route read and assertion**

Inside the existing `describe('auth route protection safeguards', ...)` block, add:

```js
  const adminSettingsRoute = fs.readFileSync(path.join(process.cwd(), 'app', 'api', 'admin', 'settings', 'route.js'), 'utf8');
```

alongside the other reads, and add to the existing first `it()` block (the one
asserting `resolveSession` presence):

```js
    expect(adminSettingsRoute.match(/resolveSession/g)?.length).toBeGreaterThanOrEqual(3);
```

(3, not 2 — one `import` line plus two handlers, `GET` and `PATCH`, matching the
corrected pattern from Fase 4's fix round 2. Verify by reading
`web/app/api/admin/settings/route.js` after Task 12 to confirm it really has exactly
1 import + 2 handler-level `resolveSession(...)` calls before relying on this number.)

- [ ] **Step 2: Run the test to verify it passes**

Run: `cd web && npx vitest run tests/acceptance-coverage.test.mjs`
Expected: PASS

- [ ] **Step 3: Run the full test suite**

Run: `cd web && npx vitest run`
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add web/tests/acceptance-coverage.test.mjs
git commit -m "test(web): extend route-protection safety net to admin settings route"
```

---

### Task 16: Deploy and verify end-to-end

**Files:** none (operational task against the VPS).

- [ ] **Step 1: Run the full local test suite**

Run: `cd web && npx vitest run`
Expected: all tests pass, including every test file added/modified in Tasks 1-15.

- [ ] **Step 2: Generate and record `SETTINGS_ENCRYPTION_KEY`**

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Append the result to `/opt/xadrez-essencial/.env` on the VPS as
`SETTINGS_ENCRYPTION_KEY=<generated value>` — this value is only ever generated
once; losing it means every encrypted setting becomes unrecoverable (would need to
be re-entered from scratch, which is fine since they're admin-editable, but worth
noting).

- [ ] **Step 3: Push and sync the VPS checkout**

```bash
git push origin main
ssh -i "$VPS_SSH_KEY" "$VPS_HOST" "cd /opt/xadrez-essencial/src && git pull"
```

- [ ] **Step 4: Apply the new migration on the VPS**

```bash
cat migrations/004_settings.sql | ssh -i "$VPS_SSH_KEY" "$VPS_HOST" \
  "docker exec -i xadrez-postgres psql -U xadrez -d xadrez"
ssh -i "$VPS_SSH_KEY" "$VPS_HOST" \
  "docker exec xadrez-postgres psql -U xadrez -d xadrez -c \"insert into schema_migrations (filename) values ('004_settings.sql') on conflict do nothing;\""
```

Expected: no SQL errors; `schema_migrations` now lists `001_init.sql` through
`004_settings.sql`; `select * from settings;` shows the 4 seeded product rows.

- [ ] **Step 5: Rebuild and restart the app container**

```bash
ssh -i "$VPS_SSH_KEY" "$VPS_HOST" \
  "cd /opt/xadrez-essencial/src && docker compose -f deploy/docker-compose.yml --env-file /opt/xadrez-essencial/.env build app"
ssh -i "$VPS_SSH_KEY" "$VPS_HOST" \
  "cd /opt/xadrez-essencial/src && docker compose -f deploy/docker-compose.yml --env-file /opt/xadrez-essencial/.env up -d app"
```

- [ ] **Step 6: Verify `/api/config` still works and reflects the seeded product**

```bash
curl -s https://chess.dlsistemas.com.br/api/config
```

Expected: `product.amountCents` is `3990`, `product.title` is `"Xadrez Essencial"` —
identical to before this phase (confirms the seed + DB-first read path works and
checkout's displayed price hasn't changed).

- [ ] **Step 7: Verify the admin config UI — product settings**

- Log in at `/admin/login`, click "Configurações".
- Confirm the form loads with the seeded product title/description/price/currency.
- Change the price (e.g. to `4990`), save, confirm `/api/config` now reflects the
  new price.
- Change it back to `3990` to avoid leaving a confusing test value in place.

- [ ] **Step 8: Verify the admin config UI — encrypted fields**

- On the same page, type a test value into "Access token" (Mercado Pago) and save.
- Reload the page — confirm the field shows "(configurado ✓)" and the input is
  empty (never echoes the value back).
- Query the DB directly to confirm the stored value is ciphertext, not plaintext:

```bash
ssh -i "$VPS_SSH_KEY" "$VPS_HOST" \
  "docker exec xadrez-postgres psql -U xadrez -d xadrez -c \"select key, encrypted, left(value, 20) from settings where key = 'mercadopago_access_token';\""
```

Expected: `encrypted = t`, and the value column shows a hex string (not the typed
test value).

- If you have real Mercado Pago TEST credentials and/or SMTP credentials at this
  point, this is a good moment to enter them for real via this same screen — it
  finally resolves Fase 2's long-pending credential gap without needing SSH.

- [ ] **Step 9: Verify admin action logging**

```bash
ssh -i "$VPS_SSH_KEY" "$VPS_HOST" \
  "docker exec xadrez-postgres psql -U xadrez -d xadrez -c \"select event, detail, created_at from access_log where detail like '%update_settings%' order by created_at desc limit 5;\""
```

Expected: rows for each settings save performed in Steps 7-8.

- [ ] **Step 10: Verify the dashboard**

- Visit `/admin` (the home page) and confirm it shows real numbers: paid order
  count, total revenue, status breakdown, and a recent-orders table — cross-check
  a couple of values against a direct query:

```bash
ssh -i "$VPS_SSH_KEY" "$VPS_HOST" \
  "docker exec xadrez-postgres psql -U xadrez -d xadrez -c \"select status, count(*) from orders group by status;\""
```

- [ ] **Step 11: Verify no regression on the checkout page itself**

- Visit `https://chess.dlsistemas.com.br/` and confirm the landing page still loads
  and shows the (possibly updated) price without errors.

- [ ] **Step 12: Update the backlog**

Edit `BACKLOG.md`: mark Fase 5 as done (linking this spec/plan), describing what
shipped (encrypted settings + dashboard) and noting this closes out the "Painel
admin" backlog line entirely (dashboard, lessons CRUD from Fase 4, and settings are
all now covered).

- [ ] **Step 13: Commit the backlog update**

```bash
git add BACKLOG.md
git commit -m "docs: mark Fase 5 (settings + dashboard) as deployed and verified"
git push origin main
ssh -i "$VPS_SSH_KEY" "$VPS_HOST" "cd /opt/xadrez-essencial/src && git pull"
```

## Self-review notes

- Spec coverage: schema+encryption (Tasks 1-2), settings store (Tasks 3-5),
  dashboard lib (Task 6), all Fase 2 consumer refactors (Tasks 7-11), admin
  settings routes+UI (Tasks 12-13), dashboard UI (Task 14), test safety net
  (Task 15), deploy+verification (Task 16) — every spec section covered.
- Cross-task interface consistency verified by hand: `getProductSettings`/
  `getMercadoPagoSettings`/`getSmtpSettings`/`getProductAccessUrl` are defined once
  in Task 4 and consumed with matching names/shapes in Tasks 7, 8, 9, 10, 11.
  `isEncryptedSetting`/`getAllSettingsForAdmin`/`setSetting` (Task 3) are consumed
  identically in Task 12.
- `buildEmail`'s signature change (Task 9) is a deliberate, contained break — its
  only caller (`processEmailOutbox`, same file) and its only test file are both
  updated in the same task, so no other task depends on the old two-positional-arg
  shape.
- `PRODUCT` (constants.js) removal is deliberately sequenced: Task 7 (`orders.js`)
  and Task 8 (`mercadopago.js`) each stop *using* `PRODUCT` without touching
  `constants.js` itself, since `web/lib/email.js` (and its test) still depend on
  it until Task 9 — which is the only task that both finishes migrating the last
  consumer and removes the export, in the same commit. This avoids the broken
  window a naive "remove it as soon as its first consumer is fixed" ordering
  would have created.
- Out of scope, unchanged from the spec: `DATABASE_URL`/`APP_BASE_URL`/
  `CRON_SECRET`/`SETTINGS_ENCRYPTION_KEY` stay `.env`-only; no encryption-key
  rotation tooling; no dashboard metrics beyond sales.
