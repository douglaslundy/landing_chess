# Fase 2 — Migrar app atual para Next.js — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the current Vercel-hosted app (static landing/checkout
frontend + serverless API + Vercel Cron reconciliation) into the Next.js
app (`web/`) that Fase 1 stood up on the VPS, so
`https://chess.dlsistemas.com.br` serves the real product instead of the
Fase 1 skeleton — with feature parity, not a redesign.

**Architecture:** Business logic in `api/_lib/*` is ported near-verbatim
into `web/lib/*` (CommonJS → ESM only, no logic changes except two
deliberate hardening fixes carried over from Fase 1's review: no
`error.message`/stack leakage in HTTP error responses). Each Vercel
`(req, res)` handler becomes an App Router Route Handler
(`Request`/`Response`, Fetch API). The static frontend
(`index.html`/`success.html`/`assets/*`) is copied byte-for-byte into
`web/public/` and served via a Next.js rewrite from `/`. Reconciliation
moves from Vercel Cron to an in-process scheduler
(`web/instrumentation.js` + `node-cron`), with the same logic also
reachable as a manually-triggerable authenticated route for parity with
today's behavior. `migrations/` and `scripts/migrate.js` stay at the repo
root (not duplicated into `web/`), reused as-is against the VPS's
Postgres.

**Tech Stack:** Next.js 15 App Router (already in `web/` from Fase 1),
`zod` (validation), `nodemailer` (SMTP), `node-cron` (in-process
scheduling), `pg` (already present), Vitest.

**Spec:** `docs/superpowers/specs/2026-09-15-fase2-app-migration-design.md`

## Global Constraints

- Reuse business logic near-verbatim from `api/_lib/*` — this is a
  migration, not a rewrite. The only intentional logic deviations are
  spelled out below; anything else that looks different from the source
  file is a bug, not a judgment call.
- **Error responses never include `error.message`, stack traces, or raw
  provider error text beyond what's explicitly called for below.** This
  mirrors a real finding from Fase 1's final review (the health endpoint
  leaked internal Postgres error details to anonymous callers) — apply
  the same hygiene proactively everywhere in this migration rather than
  porting the original's `message: error.message` leaks forward. The one
  exception: payment endpoints (`pix`, `card`) keep `provider: error.body`
  in their error response, because that's Mercado Pago's own user-facing
  decline reason and the checkout UI needs it to explain a failed card to
  the buyer — that is not an internal-infrastructure leak.
- **No new unit tests for DB-touching functions.** This codebase's
  existing convention (visible in the current `tests/` suite) only unit
  tests pure functions (schema validation, signature verification, email
  templating) — nothing that touches Postgres is mocked/unit-tested; DB
  behavior is verified live during deploy. Follow that same convention for
  every ported function; do not introduce new DB mocking.
- `web/package.json` has `"type": "module"` — every new/ported file in
  `web/` uses `import`/`export`, never `require`/`module.exports`.
- Secrets (Mercado Pago, SMTP, `CRON_SECRET`, `PRODUCT_ACCESS_URL`) are
  never committed — they go straight into `/opt/xadrez-essencial/.env` on
  the VPS at deploy time (Task 9), same discipline as Fase 1.
- Never run a destructive command or mutation on the VPS without the
  user's explicit confirmation immediately before that specific command
  (same rule as Fase 1 — Task 9 has the mutating steps marked).
- Domain is already `https://chess.dlsistemas.com.br`, DNS already points
  at the VPS (confirmed live in this session) — no DNS work in this plan.
- Database is empty/test-only (confirmed with the user) — no data
  migration, only fresh schema application.

---

## File Structure

New/modified files, grouped by task:

- **Task 1:** `web/lib/db.js` (extend)
- **Task 2:** `web/lib/constants.js`, `web/lib/schemas.js`,
  `web/lib/webhook.js`, `web/lib/http.js`, `web/tests/security.test.mjs`,
  `web/tests/webhook.test.mjs`, `web/package.json` (add `zod`)
- **Task 3:** `web/lib/env.js`, `web/lib/rate-limit.js`,
  `web/lib/mercadopago.js`, `web/lib/orders.js`
- **Task 4:** `web/lib/email.js`, `web/tests/email.test.mjs`,
  `web/package.json` (add `nodemailer`)
- **Task 5:** `web/lib/reconcile.js`,
  `web/app/api/cron/reconcile/route.js`, `web/instrumentation.js`,
  `web/package.json` (add `node-cron`)
- **Task 6:** `web/app/api/config/route.js`, `web/app/api/orders/route.js`
- **Task 7:** `web/app/api/payments/pix/route.js`,
  `web/app/api/payments/card/route.js`,
  `web/app/api/mercadopago/webhook/route.js`
- **Task 8:** `web/public/index.html`, `web/public/success.html`,
  `web/public/assets/*`, `web/next.config.mjs` (add `rewrites()`), delete
  `web/app/page.js`, `web/tests/frontend.test.mjs`,
  `web/tests/acceptance-coverage.test.mjs`
- **Task 9:** VPS deploy — migrations, secrets, redeploy, verification
  (no repo files, except a `BACKLOG.md` update at the end)
- **Task 10:** delete `api/`, `index.html`, `assets/`, `success.html`,
  `vercel.json`, `tests/`, root `vitest.config.mjs`; rewrite
  `scripts/migrate.js` → `scripts/migrate.mjs` importing from
  `web/lib/db.js`; trim root `package.json`

---

### Task 1: Extend `web/lib/db.js` with `query`/`withTransaction`

**Files:**
- Modify: `web/lib/db.js`

**Interfaces:**
- Produces: `query(text, params = []): Promise<QueryResult>`,
  `withTransaction(callback): Promise<T>` — added alongside the existing
  `checkDatabaseConnection`/`resetPoolForTests`/(internal) `getPool`.
  Consumed by every later task's `lib/*.js` files.
- Consumes: nothing new (same `getPool()` singleton already in the file).

- [ ] **Step 1: Read the current file to confirm the exact starting content**

`web/lib/db.js` currently is:

```js
import { Pool } from 'pg';

let pool;

function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === 'true'
        ? { rejectUnauthorized: process.env.DATABASE_SSL_INSECURE !== 'true' }
        : false,
      max: 3
    });
  }
  return pool;
}

export async function checkDatabaseConnection() {
  const result = await getPool().query('SELECT 1 AS ok');
  return result.rows[0]?.ok === 1;
}

export function resetPoolForTests() {
  pool = undefined;
}
```

- [ ] **Step 2: Add `query` and `withTransaction`, ported from `api/_lib/db.js`**

Append these two exports at the end of `web/lib/db.js` (everything above
stays exactly as it is):

```js

export async function query(text, params = []) {
  return getPool().query(text, params);
}

export async function withTransaction(callback) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
```

- [ ] **Step 3: Run the existing Fase 1 test to confirm nothing broke**

```bash
cd web
npm test
```

Expected: `web/tests/db.test.mjs` still 2/2 passing — this task only adds
exports, it doesn't touch `checkDatabaseConnection`/`resetPoolForTests`.

- [ ] **Step 4: Commit**

```bash
git add web/lib/db.js
git commit -m "feat(web): add query/withTransaction to db.js for app migration"
```

---

### Task 2: Port constants, schemas, webhook signature, and HTTP helpers (+ their tests)

**Files:**
- Create: `web/lib/constants.js`
- Create: `web/lib/schemas.js`
- Create: `web/lib/webhook.js`
- Create: `web/lib/http.js`
- Create: `web/tests/security.test.mjs`
- Create: `web/tests/webhook.test.mjs`
- Modify: `web/package.json` (add `zod` dependency)

**Interfaces:**
- Produces: `PRODUCT`, `TERMINAL_PAYMENT_STATUSES`,
  `CONFIRMED_PAYMENT_STATUS` (constants.js); `createOrderSchema`,
  `orderTokenSchema`, `cardPaymentSchema` (schemas.js);
  `verifyMercadoPagoSignature({ xSignature, xRequestId, dataId, secret }):
  boolean`, `parseSignature(signature)` (webhook.js);
  `getClientIp(request): string`, `publicOrder(order, attempt): object`
  (http.js). All consumed by Tasks 3, 5, 6, 7.
- Consumes: nothing from earlier tasks.

- [ ] **Step 1: Add `zod` to `web/package.json`**

In `web/package.json`, add to `"dependencies"` (alphabetical with the
existing four):

```json
    "next": "^15.5.0",
    "pg": "^8.23.0",
    "react": "^19.1.0",
    "react-dom": "^19.1.0",
    "zod": "^4.6.4"
```

(Reorder the existing four alphabetically as shown — purely cosmetic,
matches the root project's existing `package.json` ordering convention.)

- [ ] **Step 2: Create `web/lib/constants.js`**

```js
export const PRODUCT = Object.freeze({
  code: 'xadrez-essencial-pdf',
  title: 'Xadrez Essencial',
  description: 'Livro digital Xadrez Essencial, 10 volumes em PDF',
  amountCents: 3990,
  currency: 'BRL'
});

export const TERMINAL_PAYMENT_STATUSES = new Set([
  'approved',
  'authorized',
  'rejected',
  'cancelled',
  'refunded',
  'charged_back'
]);

export const CONFIRMED_PAYMENT_STATUS = 'approved';
```

- [ ] **Step 3: Create `web/lib/schemas.js`**

```js
import { z } from 'zod';

export const createOrderSchema = z.object({
  buyerName: z.string().trim().min(3).max(120),
  buyerEmail: z.string().trim().email().max(180),
  documentType: z.string().trim().max(12).optional().or(z.literal('')),
  documentNumber: z.string().trim().max(32).optional().or(z.literal(''))
});

export const orderTokenSchema = z.object({
  orderToken: z.string().trim().min(32).max(128)
});

export const cardPaymentSchema = orderTokenSchema.extend({
  token: z.string().trim().min(8).max(512),
  paymentMethodId: z.string().trim().min(1).max(40),
  issuerId: z.union([z.string(), z.number()]).optional().nullable(),
  installments: z.coerce.number().int().min(1).max(24),
  identificationType: z.string().trim().max(12).optional().or(z.literal('')),
  identificationNumber: z.string().trim().max(32).optional().or(z.literal(''))
});
```

- [ ] **Step 4: Create `web/lib/webhook.js`**

```js
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
```

- [ ] **Step 5: Create `web/lib/http.js`**

Only the two functions from `api/_lib/http.js` that don't depend on
Node's `(req, res)` shape survive here — `sendJson`/`readJson`/`method`
are replaced by native `NextResponse.json()`/`request.json()`/Next's
automatic 405 handling directly in each route (Tasks 6-7), so they have
no equivalent file. `getClientIp` is adapted to read from a Fetch
`Request`'s `headers.get(...)` instead of Node's `req.headers[...]`, and
drops the `req.socket?.remoteAddress` fallback (not available on a Fetch
`Request`; behind Traefik, `x-forwarded-for` is always present).

```js
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
```

- [ ] **Step 6: Create `web/tests/security.test.mjs`** (ported from
  `tests/security.test.mjs`, plain `import` instead of `createRequire`)

```js
import { describe, expect, it } from 'vitest';
import { createOrderSchema, cardPaymentSchema } from '../lib/schemas.js';
import { PRODUCT } from '../lib/constants.js';

describe('checkout input validation', () => {
  it('does not accept price or product values from the browser when creating orders', () => {
    const parsed = createOrderSchema.parse({
      buyerName: 'Douglas Lundy',
      buyerEmail: 'douglas@example.com',
      amountCents: 1,
      productCode: 'alterado'
    });

    expect(parsed.amountCents).toBeUndefined();
    expect(PRODUCT.amountCents).toBe(3990);
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

- [ ] **Step 7: Create `web/tests/webhook.test.mjs`** (ported from
  `tests/webhook.test.mjs`, plain `import` instead of `createRequire`)

```js
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
```

- [ ] **Step 8: Install and run tests**

```bash
cd web
npm install
npm test
```

Expected: `web/tests/db.test.mjs` (2), `security.test.mjs` (2),
`webhook.test.mjs` (3) all passing — 7/7 total in `web/`.

- [ ] **Step 9: Commit**

```bash
git add web/lib/constants.js web/lib/schemas.js web/lib/webhook.js web/lib/http.js web/tests/security.test.mjs web/tests/webhook.test.mjs web/package.json web/package-lock.json
git commit -m "feat(web): port constants, schemas, webhook signature and HTTP helpers"
```

---

### Task 3: Port env config, rate limiting, Mercado Pago client, and order logic

**Files:**
- Create: `web/lib/env.js`
- Create: `web/lib/rate-limit.js`
- Create: `web/lib/mercadopago.js`
- Create: `web/lib/orders.js`

**Interfaces:**
- Produces: `required(name)`, `optional(name, fallback)`,
  `publicConfig()`, `serverConfig()`, `smtpConfig()` (env.js);
  `rateLimit({ key, limit, windowSeconds }): Promise<boolean>`
  (rate-limit.js); `amountFromCents(cents)`, `createPayment({ order,
  attempt, payment })`, `getPayment(paymentId)`,
  `searchPaymentsByExternalReference(orderId)` (mercadopago.js);
  `createOrder(...)`, `getOrderByToken(token)`, `getLatestAttempt(orderId)`,
  `getReusableAttempt(orderId, method)`, `createAttempt(orderId, method)`,
  `updateAttemptFromPayment(attemptId, payment)`,
  `applyOfficialPayment(payment)` (orders.js). Consumed by Tasks 4, 5, 6, 7.
- Consumes: `query`/`withTransaction` from `web/lib/db.js` (Task 1),
  `PRODUCT`/`CONFIRMED_PAYMENT_STATUS` from `web/lib/constants.js` (Task 2).

No dedicated tests in this task — per Global Constraints, DB-touching
functions aren't unit-mocked in this codebase, and `env.js`'s functions
are exercised indirectly by every other test in this suite via the env
vars they set.

- [ ] **Step 1: Create `web/lib/env.js`**

```js
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
```

- [ ] **Step 2: Create `web/lib/rate-limit.js`**

```js
import { query } from './db.js';

export async function rateLimit({ key, limit, windowSeconds }) {
  const result = await query(
    `
    insert into request_limits (key, window_start, count)
    values ($1, now(), 1)
    on conflict (key) do update set
      count = case
        when request_limits.window_start < now() - ($2::int * interval '1 second') then 1
        else request_limits.count + 1
      end,
      window_start = case
        when request_limits.window_start < now() - ($2::int * interval '1 second') then now()
        else request_limits.window_start
      end
    returning count
    `,
    [key, windowSeconds]
  );
  return Number(result.rows[0].count) <= limit;
}
```

- [ ] **Step 3: Create `web/lib/mercadopago.js`**

```js
import { serverConfig } from './env.js';
import { PRODUCT } from './constants.js';

export function amountFromCents(cents) {
  return Number((cents / 100).toFixed(2));
}

async function mercadoPagoRequest(path, options = {}) {
  const { mercadoPagoAccessToken } = serverConfig();
  const response = await fetch(`https://api.mercadopago.com${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${mercadoPagoAccessToken}`,
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
    transaction_amount: amountFromCents(PRODUCT.amountCents),
    description: PRODUCT.description,
    external_reference: order.id,
    notification_url: `${appBaseUrl}/api/mercadopago/webhook`,
    metadata: {
      order_id: order.id,
      product_code: PRODUCT.code,
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

- [ ] **Step 4: Create `web/lib/orders.js`**

```js
import crypto from 'node:crypto';
import { withTransaction, query } from './db.js';
import { PRODUCT, CONFIRMED_PAYMENT_STATUS } from './constants.js';

function uuid() {
  return crypto.randomUUID();
}

export async function createOrder({ buyerName, buyerEmail, documentType, documentNumber }) {
  const result = await query(
    `
    insert into orders (
      id, public_token, product_code, product_title, amount_cents, currency,
      buyer_name, buyer_email, document_type, document_number, status
    )
    values ($1, $2, $3, $4, $5, $6, $7, lower($8), $9, $10, 'created')
    returning *
    `,
    [
      uuid(),
      crypto.randomBytes(32).toString('hex'),
      PRODUCT.code,
      PRODUCT.title,
      PRODUCT.amountCents,
      PRODUCT.currency,
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
      payment.currency_id || PRODUCT.currency,
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
      payment.metadata?.product_code !== PRODUCT.code ||
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

- [ ] **Step 5: Verify the module graph loads (smoke check, not a full test)**

```bash
cd web
node --input-type=module -e "import('./lib/orders.js').then(() => console.log('orders.js OK'))"
node --input-type=module -e "import('./lib/mercadopago.js').then(() => console.log('mercadopago.js OK'))"
node --input-type=module -e "import('./lib/rate-limit.js').then(() => console.log('rate-limit.js OK'))"
node --input-type=module -e "import('./lib/env.js').then(() => console.log('env.js OK'))"
```

Expected: all four print `OK` with no import errors.

- [ ] **Step 6: Run the existing test suite to confirm no regressions**

```bash
cd web
npm test
```

Expected: still 7/7 passing (this task adds no new tests, per Global
Constraints).

- [ ] **Step 7: Commit**

```bash
git add web/lib/env.js web/lib/rate-limit.js web/lib/mercadopago.js web/lib/orders.js
git commit -m "feat(web): port env config, rate limiting, Mercado Pago client and order logic"
```

---

### Task 4: Port email delivery

**Files:**
- Create: `web/lib/email.js`
- Create: `web/tests/email.test.mjs`
- Modify: `web/package.json` (add `nodemailer` dependency)

**Interfaces:**
- Produces: `buildEmail(order): { subject, text, html }`,
  `processEmailOutbox(limit = 10): Promise<Array>`. Consumed by Task 5
  (`reconcile.js`) and Task 7 (`mercadopago/webhook/route.js`).
- Consumes: `smtpConfig`/`serverConfig` from `web/lib/env.js` (Task 3),
  `withTransaction`/`query` from `web/lib/db.js` (Task 1), `PRODUCT` from
  `web/lib/constants.js` (Task 2).

- [ ] **Step 1: Add `nodemailer` to `web/package.json`**

In `"dependencies"`:

```json
    "next": "^15.5.0",
    "nodemailer": "^10.0.9",
    "pg": "^8.23.0",
    "react": "^19.1.0",
    "react-dom": "^19.1.0",
    "zod": "^4.6.4"
```

- [ ] **Step 2: Create `web/lib/email.js`**

```js
import nodemailer from 'nodemailer';
import { smtpConfig, serverConfig } from './env.js';
import { withTransaction, query } from './db.js';
import { PRODUCT } from './constants.js';

function transporter() {
  const cfg = smtpConfig();
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.password },
    requireTLS: !cfg.secure
  });
}

export function buildEmail(order) {
  const { productAccessUrl } = serverConfig();
  const subject = 'Seu acesso ao Xadrez Essencial';
  const text = [
    `Olá, ${order.buyer_name}.`,
    '',
    `Recebemos a confirmação do pagamento da compra ${order.id}.`,
    `Acesse o produto digital aqui: ${productAccessUrl}`,
    '',
    'Este link é fixo e pode ser compartilhado. Ele não é um controle individual de acesso.',
    '',
    'Douglas Lundy'
  ].join('\n');
  const html = `
    <p>Olá, ${escapeHtml(order.buyer_name)}.</p>
    <p>Recebemos a confirmação do pagamento da compra <strong>${order.id}</strong>.</p>
    <p><a href="${productAccessUrl}" style="display:inline-block;background:#d10e17;color:#fff;padding:14px 18px;border-radius:8px;text-decoration:none;font-weight:700">Acessar ${PRODUCT.title}</a></p>
    <p>Se o botão não abrir, use este link:<br><a href="${productAccessUrl}">${productAccessUrl}</a></p>
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
      select e.*, o.buyer_name, o.buyer_email
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

  const mailer = jobs.length ? transporter() : null;
  const results = [];
  for (const job of jobs) {
    try {
      const cfg = smtpConfig();
      const message = buildEmail(job);
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
```

- [ ] **Step 3: Create `web/tests/email.test.mjs`** (ported from
  `tests/email.test.mjs`, plain `import` instead of `createRequire`)

```js
import { describe, expect, it } from 'vitest';
import { buildEmail } from '../lib/email.js';

process.env.APP_BASE_URL = 'https://app.example';
process.env.MERCADOPAGO_ACCESS_TOKEN = 'TEST-token';
process.env.DATABASE_URL = 'postgres://user:pass@example/db';
process.env.PRODUCT_ACCESS_URL = 'https://produto.example/acesso';
process.env.CRON_SECRET = 'secret';

describe('delivery email', () => {
  it('renders html and text with the server-only product URL', () => {
    const email = buildEmail({
      id: 'order-id',
      buyer_name: 'Douglas'
    });

    expect(email.subject).toContain('Xadrez Essencial');
    expect(email.text).toContain('https://produto.example/acesso');
    expect(email.html).toContain('https://produto.example/acesso');
  });
});
```

- [ ] **Step 4: Install and run tests**

```bash
cd web
npm install
npm test
```

Expected: 8/8 passing in `web/`.

- [ ] **Step 5: Commit**

```bash
git add web/lib/email.js web/tests/email.test.mjs web/package.json web/package-lock.json
git commit -m "feat(web): port email delivery with outbox processing"
```

---

### Task 5: Reconciliation logic + in-process scheduler

**Files:**
- Create: `web/lib/reconcile.js`
- Create: `web/app/api/cron/reconcile/route.js`
- Create: `web/instrumentation.js`
- Modify: `web/package.json` (add `node-cron` dependency)

**Interfaces:**
- Produces: `runReconciliation(): Promise<{ reconciled: string[], emails:
  Array }>` — the extracted body of the old `api/cron/reconcile.js`, with
  no HTTP/auth envelope. Called from two places: the scheduler
  (`instrumentation.js`) and the manual-trigger route (this task).
- Consumes: `query` (Task 1), `getPayment`/`searchPaymentsByExternalReference`
  (Task 3), `applyOfficialPayment` (Task 3), `processEmailOutbox` (Task 4),
  `required` (Task 3).

- [ ] **Step 1: Add `node-cron` to `web/package.json`**

In `"dependencies"`:

```json
    "next": "^15.5.0",
    "node-cron": "^4.2.1",
    "nodemailer": "^10.0.9",
    "pg": "^8.23.0",
    "react": "^19.1.0",
    "react-dom": "^19.1.0",
    "zod": "^4.6.4"
```

- [ ] **Step 2: Create `web/lib/reconcile.js`**

Extracted from `api/cron/reconcile.js` — the query/reconciliation body,
with the HTTP envelope (auth check, `sendJson`) stripped out:

```js
import { query } from './db.js';
import { getPayment, searchPaymentsByExternalReference } from './mercadopago.js';
import { applyOfficialPayment } from './orders.js';
import { processEmailOutbox } from './email.js';

export async function runReconciliation() {
  const pendingAttempts = await query(
    `
    select distinct on (o.id) o.id as order_id, a.mp_payment_id
    from orders o
    left join payment_attempts a on a.order_id = o.id
    where o.status in ('created', 'pending', 'processing')
      and o.created_at > now() - interval '45 days'
    order by o.id, a.created_at desc
    limit 50
    `
  );

  const reconciled = [];
  for (const row of pendingAttempts.rows) {
    if (row.mp_payment_id) {
      const payment = await getPayment(row.mp_payment_id);
      await applyOfficialPayment(payment);
      reconciled.push(row.mp_payment_id);
    } else {
      const search = await searchPaymentsByExternalReference(row.order_id);
      for (const payment of search.results || []) {
        await applyOfficialPayment(payment);
        reconciled.push(String(payment.id));
      }
    }
  }

  const emails = await processEmailOutbox(20);
  return { reconciled, emails };
}
```

- [ ] **Step 3: Create `web/app/api/cron/reconcile/route.js`**

Kept as a manually-triggerable, `Bearer ${CRON_SECRET}`-protected
endpoint for parity with today's behavior (observability/manual trigger)
— same auth contract as before, but delegating the actual work to
`runReconciliation()`. Per Global Constraints, the error response drops
`error.message` (the original leaked it; this endpoint is
auth-protected, not public, but there's no reason to carry the leak
forward).

```js
import { NextResponse } from 'next/server';
import { required } from '../../../../lib/env.js';
import { runReconciliation } from '../../../../lib/reconcile.js';

async function handleReconcile(request) {
  const auth = request.headers.get('authorization') || '';
  if (auth !== `Bearer ${required('CRON_SECRET')}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const result = await runReconciliation();
    return NextResponse.json(result);
  } catch (error) {
    console.error('[cron/reconcile] failed:', error);
    return NextResponse.json({ error: 'reconcile_error' }, { status: 500 });
  }
}

export async function GET(request) {
  return handleReconcile(request);
}

export async function POST(request) {
  return handleReconcile(request);
}
```

- [ ] **Step 4: Create `web/instrumentation.js`**

Runs once when the Next.js server process starts (works with `output:
'standalone'`, unlike a custom server). Schedules `runReconciliation()`
every 10 minutes (matching the old Vercel Cron schedule
`*/10 * * * *`), with an in-memory lock so an overlapping run is skipped
rather than stacked if one execution takes longer than the interval.

```js
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const cron = await import('node-cron');
  const { runReconciliation } = await import('./lib/reconcile.js');

  let running = false;
  cron.default.schedule('*/10 * * * *', async () => {
    if (running) return;
    running = true;
    try {
      await runReconciliation();
    } catch (error) {
      console.error('[instrumentation] scheduled reconciliation failed:', error);
    } finally {
      running = false;
    }
  });
}
```

- [ ] **Step 5: Install and run the existing test suite**

```bash
cd web
npm install
npm test
```

Expected: still 8/8 passing (no new tests for this task — scheduling and
the route's auth wrapper aren't unit tested in this codebase's existing
convention; correctness is verified live in Task 9's deploy).

- [ ] **Step 6: Commit**

```bash
git add web/lib/reconcile.js web/app/api/cron/reconcile/route.js web/instrumentation.js web/package.json web/package-lock.json
git commit -m "feat(web): move reconciliation to in-process scheduler plus manual trigger route"
```

---

### Task 6: `config` and `orders` route handlers

**Files:**
- Create: `web/app/api/config/route.js`
- Create: `web/app/api/orders/route.js`

**Interfaces:**
- Produces: `GET /api/config` → public config JSON. `GET /api/orders?token=...`
  → order status JSON. `POST /api/orders` → creates an order, `201`.
- Consumes: `publicConfig` (Task 3), `PRODUCT` (Task 2), `createOrder`/
  `getOrderByToken`/`getLatestAttempt` (Task 3), `getClientIp`/`publicOrder`
  (Task 2), `createOrderSchema`/`orderTokenSchema` (Task 2), `rateLimit`
  (Task 3).

- [ ] **Step 1: Create `web/app/api/config/route.js`**

```js
import { NextResponse } from 'next/server';
import { publicConfig } from '../../../lib/env.js';
import { PRODUCT } from '../../../lib/constants.js';

export async function GET() {
  try {
    return NextResponse.json({
      ...publicConfig(),
      product: {
        title: PRODUCT.title,
        amountCents: PRODUCT.amountCents,
        currency: PRODUCT.currency
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

- [ ] **Step 2: Create `web/app/api/orders/route.js`**

The original Vercel handler combined `GET`/`POST` in one function with an
`if (req.method === 'POST')` branch; the App Router requires separate
exported functions per method, so this splits into `GET` and `POST` (each
keeps its own identical rate-limit check, matching the original's
per-request behavior).

```js
import { NextResponse } from 'next/server';
import { createOrder, getOrderByToken, getLatestAttempt } from '../../../lib/orders.js';
import { getClientIp, publicOrder } from '../../../lib/http.js';
import { createOrderSchema, orderTokenSchema } from '../../../lib/schemas.js';
import { rateLimit } from '../../../lib/rate-limit.js';

export async function GET(request) {
  try {
    const ip = getClientIp(request);
    const allowed = await rateLimit({ key: `orders:${ip}`, limit: 20, windowSeconds: 300 });
    if (!allowed) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

    const url = new URL(request.url);
    const parsed = orderTokenSchema.parse({ orderToken: url.searchParams.get('token') });
    const order = await getOrderByToken(parsed.orderToken);
    if (!order) return NextResponse.json({ error: 'order_not_found' }, { status: 404 });
    const attempt = await getLatestAttempt(order.id);
    return NextResponse.json(publicOrder(order, attempt));
  } catch (error) {
    if (error.name === 'ZodError') {
      return NextResponse.json({ error: 'invalid_input', details: error.issues }, { status: 400 });
    }
    console.error('[api/orders GET] failed:', error);
    return NextResponse.json({ error: error.code || 'server_error' }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const ip = getClientIp(request);
    const allowed = await rateLimit({ key: `orders:${ip}`, limit: 20, windowSeconds: 300 });
    if (!allowed) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

    const body = createOrderSchema.parse(await request.json());
    const order = await createOrder(body);
    return NextResponse.json(publicOrder(order, null), { status: 201 });
  } catch (error) {
    if (error.name === 'ZodError') {
      return NextResponse.json({ error: 'invalid_input', details: error.issues }, { status: 400 });
    }
    console.error('[api/orders POST] failed:', error);
    return NextResponse.json({ error: error.code || 'server_error' }, { status: 500 });
  }
}
```

- [ ] **Step 3: Run the existing test suite**

```bash
cd web
npm test
```

Expected: still 8/8 passing (route handlers aren't unit tested in this
codebase's convention — same as the original Vercel handlers weren't;
verified live in Task 9).

- [ ] **Step 4: Commit**

```bash
git add web/app/api/config/route.js web/app/api/orders/route.js
git commit -m "feat(web): add config and orders route handlers"
```

---

### Task 7: Payment and webhook route handlers

**Files:**
- Create: `web/app/api/payments/pix/route.js`
- Create: `web/app/api/payments/card/route.js`
- Create: `web/app/api/mercadopago/webhook/route.js`

**Interfaces:**
- Produces: `POST /api/payments/pix`, `POST /api/payments/card` → payment
  attempt JSON. `POST /api/mercadopago/webhook` → `{ ok: true }`, the
  Mercado Pago notification receiver.
- Consumes: everything from Tasks 1-5 (`orders.js`, `mercadopago.js`,
  `rate-limit.js`, `http.js`, `schemas.js`, `db.js`, `webhook.js`,
  `env.js`, `email.js`).

- [ ] **Step 1: Create `web/app/api/payments/pix/route.js`**

```js
import { NextResponse } from 'next/server';
import { orderTokenSchema } from '../../../../lib/schemas.js';
import { getOrderByToken, getReusableAttempt, createAttempt, updateAttemptFromPayment, applyOfficialPayment } from '../../../../lib/orders.js';
import { createPayment } from '../../../../lib/mercadopago.js';
import { rateLimit } from '../../../../lib/rate-limit.js';
import { getClientIp, publicOrder } from '../../../../lib/http.js';

export async function POST(request) {
  try {
    const ip = getClientIp(request);
    const allowed = await rateLimit({ key: `pix:${ip}`, limit: 10, windowSeconds: 300 });
    if (!allowed) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

    const body = orderTokenSchema.parse(await request.json());
    const order = await getOrderByToken(body.orderToken);
    if (!order) return NextResponse.json({ error: 'order_not_found' }, { status: 404 });
    if (order.status === 'paid') return NextResponse.json(publicOrder(order, null));

    let attempt = await getReusableAttempt(order.id, 'pix');
    if (!attempt) attempt = await createAttempt(order.id, 'pix');
    if (!attempt.mp_payment_id) {
      const payment = await createPayment({
        order,
        attempt,
        payment: {
          payment_method_id: 'pix',
          date_of_expiration: new Date(Date.now() + 30 * 60 * 1000).toISOString()
        }
      });
      attempt = await updateAttemptFromPayment(attempt.id, payment);
      await applyOfficialPayment(payment);
    }
    const refreshedOrder = await getOrderByToken(body.orderToken);
    return NextResponse.json(publicOrder(refreshedOrder, attempt));
  } catch (error) {
    if (error.name === 'ZodError') {
      return NextResponse.json({ error: 'invalid_input', details: error.issues }, { status: 400 });
    }
    console.error('[api/payments/pix] failed:', error);
    return NextResponse.json({ error: 'payment_error', provider: error.body }, { status: error.status || 500 });
  }
}
```

- [ ] **Step 2: Create `web/app/api/payments/card/route.js`**

```js
import { NextResponse } from 'next/server';
import { cardPaymentSchema } from '../../../../lib/schemas.js';
import { getOrderByToken, createAttempt, updateAttemptFromPayment, applyOfficialPayment } from '../../../../lib/orders.js';
import { createPayment } from '../../../../lib/mercadopago.js';
import { rateLimit } from '../../../../lib/rate-limit.js';
import { getClientIp, publicOrder } from '../../../../lib/http.js';

export async function POST(request) {
  try {
    const ip = getClientIp(request);
    const allowed = await rateLimit({ key: `card:${ip}`, limit: 8, windowSeconds: 300 });
    if (!allowed) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

    const body = cardPaymentSchema.parse(await request.json());
    const order = await getOrderByToken(body.orderToken);
    if (!order) return NextResponse.json({ error: 'order_not_found' }, { status: 404 });
    if (order.status === 'paid') return NextResponse.json(publicOrder(order, null));

    let attempt = await createAttempt(order.id, 'card');
    const payment = await createPayment({
      order: {
        ...order,
        document_type: body.identificationType || order.document_type,
        document_number: body.identificationNumber || order.document_number
      },
      attempt,
      payment: {
        token: body.token,
        installments: body.installments,
        payment_method_id: body.paymentMethodId,
        issuer_id: body.issuerId || undefined,
        binary_mode: false,
        additional_info: {
          items: [{
            id: order.product_code,
            title: order.product_title,
            quantity: 1,
            unit_price: order.amount_cents / 100
          }]
        }
      }
    });
    attempt = await updateAttemptFromPayment(attempt.id, payment);
    if (payment.status) await applyOfficialPayment(payment);
    const refreshedOrder = await getOrderByToken(body.orderToken);
    return NextResponse.json(publicOrder(refreshedOrder, attempt));
  } catch (error) {
    if (error.name === 'ZodError') {
      return NextResponse.json({ error: 'invalid_input', details: error.issues }, { status: 400 });
    }
    console.error('[api/payments/card] failed:', error);
    return NextResponse.json({ error: 'payment_error', provider: error.body }, { status: error.status || 500 });
  }
}
```

- [ ] **Step 3: Create `web/app/api/mercadopago/webhook/route.js`**

```js
import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { query } from '../../../../lib/db.js';
import { getPayment } from '../../../../lib/mercadopago.js';
import { applyOfficialPayment } from '../../../../lib/orders.js';
import { processEmailOutbox } from '../../../../lib/email.js';
import { verifyMercadoPagoSignature } from '../../../../lib/webhook.js';
import { optional } from '../../../../lib/env.js';

export async function POST(request) {
  try {
    const url = new URL(request.url);
    const body = await request.json();
    const dataId = url.searchParams.get('data.id') || body.data?.id;
    const type = url.searchParams.get('type') || body.type;
    const secret = optional('MERCADOPAGO_WEBHOOK_SECRET');

    const signatureValid = secret ? verifyMercadoPagoSignature({
      xSignature: request.headers.get('x-signature'),
      xRequestId: request.headers.get('x-request-id'),
      dataId,
      secret
    }) : false;

    if (secret && !signatureValid) {
      await query(
        `insert into webhook_events (id, provider_event_id, topic, resource_id, signature_valid, payload)
         values ($1, $2, $3, $4, false, $5::jsonb)`,
        [crypto.randomUUID(), String(body.id || ''), String(type || ''), String(dataId || ''), JSON.stringify(body)]
      );
      return NextResponse.json({ error: 'invalid_signature' }, { status: 401 });
    }

    await query(
      `
      insert into webhook_events (id, provider_event_id, topic, resource_id, signature_valid, payload)
      values ($1, $2, $3, $4, $5, $6::jsonb)
      on conflict (topic, resource_id, provider_event_id) do update set received_at = now()
      `,
      [crypto.randomUUID(), String(body.id || ''), String(type || ''), String(dataId || ''), signatureValid, JSON.stringify(body)]
    );

    if (type === 'payment' && dataId) {
      const payment = await getPayment(dataId);
      await applyOfficialPayment(payment);
      await processEmailOutbox(5);
      await query(
        `update webhook_events set processed_at = now() where topic = $1 and resource_id = $2`,
        [String(type), String(dataId)]
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[api/mercadopago/webhook] failed:', error);
    return NextResponse.json({ error: 'webhook_processing_error' }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run the existing test suite**

```bash
cd web
npm test
```

Expected: still 8/8 passing.

- [ ] **Step 5: Commit**

```bash
git add web/app/api/payments/pix/route.js web/app/api/payments/card/route.js web/app/api/mercadopago/webhook/route.js
git commit -m "feat(web): add payment and Mercado Pago webhook route handlers"
```

---

### Task 8: Relocate the static frontend and wire the root rewrite

**Files:**
- Create: `web/public/index.html` (copy, unchanged)
- Create: `web/public/success.html` (copy, unchanged)
- Create: `web/public/assets/checkout.js`,
  `web/public/assets/success.js`,
  `web/public/assets/capa-xadrez-essencial.png`,
  `web/public/assets/exercicio-tabuleiro.png`,
  `web/public/assets/gabarito-visual.png` (copies, unchanged)
- Modify: `web/next.config.mjs` (add `rewrites()`)
- Delete: `web/app/page.js`
- Create: `web/tests/frontend.test.mjs`
- Create: `web/tests/acceptance-coverage.test.mjs`

**Interfaces:**
- Produces: `GET /` → serves `web/public/index.html` via rewrite.
  `GET /success.html`, `GET /assets/*` → served directly by Next's static
  `public/` handling, no rewrite needed (relative paths in the HTML/JS
  already resolve correctly against `/`).
- Consumes: nothing new — the ported test files read the files this task
  creates, plus `web/lib/orders.js` (Task 3) and the two webhook/reconcile
  files (Tasks 5, 7) as raw text for content assertions.

- [ ] **Step 1: Copy the frontend files unchanged**

```bash
mkdir -p web/public/assets
cp index.html web/public/index.html
cp success.html web/public/success.html
cp assets/checkout.js web/public/assets/checkout.js
cp assets/success.js web/public/assets/success.js
cp assets/capa-xadrez-essencial.png web/public/assets/capa-xadrez-essencial.png
cp assets/exercicio-tabuleiro.png web/public/assets/exercicio-tabuleiro.png
cp assets/gabarito-visual.png web/public/assets/gabarito-visual.png
```

- [ ] **Step 2: Delete the Fase 1 skeleton home page**

```bash
git rm web/app/page.js
```

(`web/app/layout.js` stays — it's still the required root layout, just
currently has no page beneath it since `/` is now served by the static
rewrite instead of an App Router page. It'll be used again once Fase 3+
adds real pages.)

- [ ] **Step 3: Add the rewrite to `web/next.config.mjs`**

```js
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const nextConfig = {
  output: 'standalone',
  outputFileTracingRoot: __dirname,
  async rewrites() {
    return [{ source: '/', destination: '/index.html' }];
  }
};

export default nextConfig;
```

- [ ] **Step 4: Create `web/tests/frontend.test.mjs`** (ported from
  `tests/frontend.test.mjs`, paths updated to `public/`)

```js
import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

describe('landing checkout frontend', () => {
  const html = fs.readFileSync(path.join(process.cwd(), 'public', 'index.html'), 'utf8');
  const js = fs.readFileSync(path.join(process.cwd(), 'public', 'assets', 'checkout.js'), 'utf8');

  it('does not expose the product access URL in the public bundle', () => {
    expect(html).not.toContain('PRODUCT_ACCESS_URL');
    expect(js).not.toContain('PRODUCT_ACCESS_URL');
  });

  it('uses backend polling and MercadoPago.js tokenized card form', () => {
    expect(html).toContain('https://sdk.mercadopago.com/js/v2');
    expect(js).toContain('/api/orders?token=');
    expect(js).toContain('mp.cardForm');
    expect(js).toContain('/api/payments/pix');
    expect(js).toContain('/api/payments/card');
  });
});
```

- [ ] **Step 5: Create `web/tests/acceptance-coverage.test.mjs`** (ported
  from `tests/acceptance-coverage.test.mjs` — paths updated; the
  `reconcile` check now reads both `app/api/cron/reconcile/route.js` and
  `lib/reconcile.js` concatenated, since Task 5 split that logic across
  two files)

```js
import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

describe('financial acceptance safeguards', () => {
  const migration = fs.readFileSync(path.join(process.cwd(), '..', 'migrations', '001_init.sql'), 'utf8');
  const frontend = fs.readFileSync(path.join(process.cwd(), 'public', 'assets', 'checkout.js'), 'utf8');
  const orders = fs.readFileSync(path.join(process.cwd(), 'lib', 'orders.js'), 'utf8');
  const webhook = fs.readFileSync(path.join(process.cwd(), 'app', 'api', 'mercadopago', 'webhook', 'route.js'), 'utf8');
  const reconcileRoute = fs.readFileSync(path.join(process.cwd(), 'app', 'api', 'cron', 'reconcile', 'route.js'), 'utf8');
  const reconcileLib = fs.readFileSync(path.join(process.cwd(), 'lib', 'reconcile.js'), 'utf8');
  const reconcile = reconcileRoute + reconcileLib;

  it('persists idempotency, webhook dedupe and one delivery outbox per order', () => {
    expect(migration).toContain('idempotency_key text not null unique');
    expect(migration).toContain('mp_payment_id text unique');
    expect(migration).toContain('unique(topic, resource_id, provider_event_id)');
    expect(migration).toContain('order_id uuid not null unique references orders');
  });

  it('tracks refunds and chargebacks without requeueing delivery', () => {
    expect(orders).toContain("payment.status === 'refunded' || payment.status === 'charged_back'");
    expect(orders).toContain('provider_events');
    expect(orders).toContain("on conflict (order_id) do nothing");
  });

  it('does not trust webhook body without official Mercado Pago lookup', () => {
    expect(webhook).toContain('verifyMercadoPagoSignature');
    expect(webhook).toContain('const payment = await getPayment(dataId)');
    expect(webhook).toContain('await applyOfficialPayment(payment)');
  });

  it('has a protected reconciliation path for missing notifications and email retries', () => {
    expect(reconcile).toContain('authorization');
    expect(reconcile).toContain('searchPaymentsByExternalReference');
    expect(reconcile).toContain('processEmailOutbox');
  });

  it('recovers order tracking after reload and renders terminal states distinctly', () => {
    expect(frontend).toContain("sessionStorage.getItem('checkoutOrderToken')");
    expect(frontend).toContain('rejected:');
    expect(frontend).toContain('cancelled:');
    expect(frontend).toContain('expired:');
    expect(frontend).toContain('refunded:');
    expect(frontend).toContain('charged_back:');
  });
});
```

- [ ] **Step 6: Run the full `web/` test suite**

```bash
cd web
npm test
```

Expected: 12/12 passing (8 from Tasks 1-7 + 2 new frontend/acceptance
tests — `frontend.test.mjs` and `acceptance-coverage.test.mjs` each add
their own `it()` blocks; count precisely from the terminal output rather
than assuming, since it's the authoritative number).

- [ ] **Step 7: Full local build — verify `/` with no `app/page.js` doesn't break the build**

```bash
cd web
npm run build
```

Expected: build succeeds. Confirm in the output that no route is listed
for `/` under "Route (app)" (since it's now handled entirely by the
static rewrite, not an App Router page) — if the build fails specifically
because Next expects at least one page under `app/`, STOP and report
back rather than guessing at a workaround; this needs a design decision,
not an improvised fix.

- [ ] **Step 8: Commit**

```bash
git add web/public web/next.config.mjs web/tests/frontend.test.mjs web/tests/acceptance-coverage.test.mjs
git commit -m "feat(web): relocate static frontend and wire root rewrite"
```

(`web/app/page.js`'s deletion was already staged by `git rm` in Step 2 —
no separate `git add` needed for it.)

---

### Task 9: Deploy to the VPS and verify end-to-end

This task runs real commands against the shared production VPS that's
already serving the Fase 1 skeleton live. **Every mutating step is
marked with a STOP — get the user's explicit confirmation immediately
before running it**, same discipline as Fase 1's Task 5.

**Files:**
- Modify: `BACKLOG.md` (Fase 2 row → done, at the end of this task)

**Interfaces:**
- Consumes: everything from Tasks 1-8, plus real secret values the user
  must provide (this task cannot proceed past Step 2 without them).

- [ ] **Step 1: Collect the real secret values from the user (not scriptable)**

Ask the user for production values for every key `/opt/xadrez-essencial/.env`
doesn't already have (it currently has `POSTGRES_USER`, `POSTGRES_PASSWORD`,
`POSTGRES_DB`, `DATABASE_URL`, `DATABASE_SSL`, `PORT` from Fase 1):

- `MERCADOPAGO_PUBLIC_KEY`
- `MERCADOPAGO_ACCESS_TOKEN`
- `MERCADOPAGO_WEBHOOK_SECRET`
- `MERCADOPAGO_EXPECTED_COLLECTOR_ID` (optional, recommended)
- `APP_BASE_URL` = `https://chess.dlsistemas.com.br`
- `PRODUCT_ACCESS_URL`
- `CRON_SECRET` (generate a fresh one with `openssl rand -hex 24` if the
  user doesn't have an existing one to reuse)
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`,
  `EMAIL_FROM`, `EMAIL_REPLY_TO` (optional)

Ask explicitly whether to use Mercado Pago TEST credentials first (safer
first verification pass) or production credentials directly — this is
the user's call given real money is involved once production keys are
live.

- [ ] **STOP — confirm with the user before Step 2.**

- [ ] **Step 2: Apply the migration against the VPS Postgres**

Postgres has no host-exposed port (by design, Fase 1 isolation), so this
runs through `docker exec` rather than a local `DATABASE_URL` connection:

```bash
cat migrations/001_init.sql | ssh -i "$VPS_SSH_KEY" "$VPS_HOST" \
  "docker exec -i xadrez-postgres psql -U xadrez -d xadrez"

ssh -i "$VPS_SSH_KEY" "$VPS_HOST" \
  "docker exec xadrez-postgres psql -U xadrez -d xadrez -c \"create table if not exists schema_migrations (filename text primary key, applied_at timestamptz not null default now()); insert into schema_migrations (filename) values ('001_init.sql') on conflict do nothing;\""
```

The `schema_migrations` bookkeeping keeps this consistent with what
`scripts/migrate.js`/`scripts/migrate.mjs` (Task 10) would track, so a
future migration file added in a later phase doesn't try to re-run
`001_init.sql`.

Verify:

```bash
ssh -i "$VPS_SSH_KEY" "$VPS_HOST" \
  "docker exec xadrez-postgres psql -U xadrez -d xadrez -c '\dt'"
```

Expected: `orders`, `payment_attempts`, `webhook_events`,
`provider_events`, `outbox_emails`, `request_limits`,
`schema_migrations` all listed.

- [ ] **STOP — confirm with the user before Step 3.**

- [ ] **Step 3: Add the new secrets to `/opt/xadrez-essencial/.env`**

Append (don't overwrite) the values collected in Step 1:

```bash
ssh -i "$VPS_SSH_KEY" "$VPS_HOST" "cat >> /opt/xadrez-essencial/.env" <<'EOF'
MERCADOPAGO_PUBLIC_KEY=<value>
MERCADOPAGO_ACCESS_TOKEN=<value>
MERCADOPAGO_WEBHOOK_SECRET=<value>
MERCADOPAGO_EXPECTED_COLLECTOR_ID=<value or omit>
APP_BASE_URL=https://chess.dlsistemas.com.br
PRODUCT_ACCESS_URL=<value>
CRON_SECRET=<value>
SMTP_HOST=<value>
SMTP_PORT=<value>
SMTP_SECURE=<value>
SMTP_USER=<value>
SMTP_PASSWORD=<value>
EMAIL_FROM=<value>
EMAIL_REPLY_TO=<value or omit>
EOF
```

Verify permissions are still correct after the append:

```bash
ssh -i "$VPS_SSH_KEY" "$VPS_HOST" "stat -c '%a %U' /opt/xadrez-essencial/.env"
```

Expected: `600 root` (unchanged from Fase 1).

- [ ] **STOP — confirm with the user before Step 4.**

- [ ] **Step 4: Push, pull, rebuild, redeploy**

```bash
git push origin main
```

```bash
ssh -i "$VPS_SSH_KEY" "$VPS_HOST" "cd /opt/xadrez-essencial/src && git pull"
ssh -i "$VPS_SSH_KEY" "$VPS_HOST" \
  "cd /opt/xadrez-essencial/src && docker compose -f deploy/docker-compose.yml --env-file /opt/xadrez-essencial/.env build"
ssh -i "$VPS_SSH_KEY" "$VPS_HOST" \
  "cd /opt/xadrez-essencial/src && docker compose -f deploy/docker-compose.yml --env-file /opt/xadrez-essencial/.env up -d"
```

- [ ] **Step 5: Verify the containers are healthy**

```bash
ssh -i "$VPS_SSH_KEY" "$VPS_HOST" "docker ps --filter name=xadrez"
```

Expected: `xadrez-app` and `xadrez-postgres` both `Up`.

- [ ] **Step 6: Verify the real frontend is live**

```bash
curl -s --max-time 15 https://chess.dlsistemas.com.br | grep -o "<title>[^<]*</title>"
```

Expected: the real product title, not "Fase 1 — esqueleto".

- [ ] **Step 7: Verify `/api/config` responds**

```bash
curl -s --max-time 15 https://chess.dlsistemas.com.br/api/config
```

Expected: JSON with `mercadoPagoPublicKey`, `product`, `polling` — no
`500`.

- [ ] **Step 8: Verify order creation end-to-end**

```bash
curl -s --max-time 15 -X POST https://chess.dlsistemas.com.br/api/orders \
  -H 'Content-Type: application/json' \
  -d '{"buyerName":"Teste Fase 2","buyerEmail":"teste@example.com"}'
```

Expected: `201`-shaped JSON with a `token` field. Save that token and
confirm `GET /api/orders?token=<token>` returns the same order with
`status: "created"`.

- [ ] **Step 9: Walk the user through one real payment test in a browser**

This can't be scripted (card tokenization happens client-side via
Mercado Pago's JS SDK). Ask the user to open
`https://chess.dlsistemas.com.br` in a browser and complete one Pix
attempt (confirm a QR code renders) and, if using TEST credentials, one
test card payment — confirming `success.html` reflects the right status
afterward.

- [ ] **Step 10: Register/confirm the Mercado Pago webhook URL**

Manual action for the user in the Mercado Pago dashboard: webhook URL
must be `https://chess.dlsistemas.com.br/api/mercadopago/webhook`. Ask
the user to confirm this is set, then trigger a test notification from
the Mercado Pago dashboard if it offers one, and check it was received:

```bash
ssh -i "$VPS_SSH_KEY" "$VPS_HOST" \
  "docker exec xadrez-postgres psql -U xadrez -d xadrez -c 'select topic, resource_id, signature_valid, received_at from webhook_events order by received_at desc limit 5;'"
```

- [ ] **Step 11: Confirm the scheduler is running**

```bash
ssh -i "$VPS_SSH_KEY" "$VPS_HOST" "docker logs xadrez-app 2>&1 | grep -i instrumentation"
```

No specific log line is guaranteed (the scheduler only logs on error),
so absence of a crash is the signal here; also confirm the manual
trigger route works as a positive check:

```bash
ssh -i "$VPS_SSH_KEY" "$VPS_HOST" \
  "docker exec xadrez-app wget -qO- --header='Authorization: Bearer <CRON_SECRET value>' http://127.0.0.1:3000/api/cron/reconcile"
```

Expected: `{"reconciled":[...],"emails":[...]}`.

- [ ] **Step 12: Isolation check (same as Fase 1)**

```bash
ssh -i "$VPS_SSH_KEY" "$VPS_HOST" "docker ps --format '{{.Names}}'" | sort > /tmp/xadrez-fase2-after-containers.txt
diff /tmp/xadrez-before-containers.txt /tmp/xadrez-fase2-after-containers.txt
```

Expected: only `xadrez-app`/`xadrez-postgres` lines, same as Fase 1 (no
new containers from this task — it redeploys the existing two, doesn't
add more).

- [ ] **Step 13: Update the backlog**

Edit `BACKLOG.md`'s Fase 2 row to `✅ Concluída (YYYY-MM-DD)`, linking
this plan, with a one-line summary of what was verified live.

- [ ] **Step 14: Commit the backlog update**

```bash
git add BACKLOG.md
git commit -m "docs: mark Fase 2 (app migration) as complete"
git push origin main
```

---

### Task 10: Clean up the now-redundant Vercel-era files

Gated on Task 9's live verification passing — don't start this task
until the real checkout has been confirmed working in production.

**Files:**
- Delete: `api/`, `index.html`, `assets/`, `success.html`, `vercel.json`,
  `tests/`, root `vitest.config.mjs`
- Delete: `scripts/migrate.js`
- Create: `scripts/migrate.mjs`
- Modify: root `package.json`

**Interfaces:**
- Produces: `node scripts/migrate.mjs` — same behavior as the old
  `scripts/migrate.js` (idempotent, tracks applied files in
  `schema_migrations`), but importing from `web/lib/db.js` instead of the
  now-deleted `api/_lib/db.js`, and written as ESM since it can no longer
  rely on the root `package.json`'s CommonJS default alongside a deleted
  `api/` directory that used it.

- [ ] **Step 1: Create `scripts/migrate.mjs`**

```js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { query, withTransaction } from '../web/lib/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  await query(`
    create table if not exists schema_migrations (
      filename text primary key,
      applied_at timestamptz not null default now()
    )
  `);
  const dir = path.join(__dirname, '..', 'migrations');
  const files = fs.readdirSync(dir).filter((file) => file.endsWith('.sql')).sort();
  for (const file of files) {
    const applied = await query('select 1 from schema_migrations where filename = $1', [file]);
    if (applied.rowCount) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    await withTransaction(async (client) => {
      await client.query(sql);
      await client.query('insert into schema_migrations (filename) values ($1)', [file]);
    });
    console.log(`applied ${file}`);
  }
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 2: Delete the old migration script and the now-redundant Vercel-era files**

```bash
git rm scripts/migrate.js
git rm -r api/ index.html assets/ success.html vercel.json tests/ vitest.config.mjs
```

- [ ] **Step 3: Rewrite the root `package.json`**

Trimmed to only what `scripts/migrate.mjs` and `scripts/check-js.js` need
(`pg` for the migration script; `mercadopago`, `nodemailer`, `zod`,
`jsdom`, `vitest` are no longer used anywhere at the repo root once
`api/`/`tests/` are gone):

```json
{
  "name": "xadrez_essencial_landing_page",
  "version": "1.0.0",
  "description": "",
  "main": "index.js",
  "scripts": {
    "migrate": "node scripts/migrate.mjs",
    "lint": "node scripts/check-js.js"
  },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/douglaslundy/landing_chess.git"
  },
  "keywords": [],
  "author": "",
  "license": "ISC",
  "type": "commonjs",
  "bugs": {
    "url": "https://github.com/douglaslundy/landing_chess/issues"
  },
  "homepage": "https://github.com/douglaslundy/landing_chess#readme",
  "dependencies": {
    "pg": "^8.23.0"
  }
}
```

(`scripts/migrate.mjs`'s `.mjs` extension makes it ESM regardless of the
root `package.json`'s `"type": "commonjs"`, so no other file at the root
needs to change module type.)

- [ ] **Step 4: Reinstall at root to prune the removed dependencies from the lockfile**

```bash
npm install
```

- [ ] **Step 5: Verify `scripts/check-js.js` still runs cleanly**

```bash
npm run lint
```

Expected: succeeds, reports checking whatever remains under `scripts/`
(the `api`/`assets`/`tests` roots it used to walk no longer exist —
`check-js.js` already skips missing directories, so this is a
non-issue, not a required code change).

- [ ] **Step 6: Verify the migration script still works against the VPS**

This is a dry confirmation only — Task 9 already applied `001_init.sql`,
so this should report nothing to apply:

```bash
DATABASE_URL="<same value as the VPS's, for a local one-off check, or run via docker exec if the VPS Postgres isn't reachable from here>" node scripts/migrate.mjs
```

If the VPS Postgres isn't reachable from the local dev environment
(expected — no host port mapped), skip this local dry run and instead
confirm by reading `schema_migrations` on the VPS directly:

```bash
ssh -i "$VPS_SSH_KEY" "$VPS_HOST" \
  "docker exec xadrez-postgres psql -U xadrez -d xadrez -c 'select * from schema_migrations;'"
```

Expected: one row, `001_init.sql`.

- [ ] **Step 7: Commit**

```bash
git add scripts/migrate.mjs package.json package-lock.json
git commit -m "chore: remove Vercel-era files now that Fase 2 is live on the VPS"
git push origin main
```

- [ ] **Step 8: Ask the user about the Vercel project itself**

Pausing or deleting the Vercel project is a separate action on a
third-party service — ask the user explicitly before doing anything
there (or doing it yourself if they hand over access); this plan doesn't
script it.

---

## Self-Review Notes

- **Spec coverage:** business-logic porting (`api/_lib/*` → `web/lib/*`)
  → Tasks 1-5; Vercel `(req,res)` → Route Handler adaptation → Tasks 6-7;
  frontend relocation + rewrite → Task 8; reconciliation moved off Vercel
  Cron → Task 5; env vars/secrets → Task 9 Steps 1-3; webhook
  registration → Task 9 Step 10; test suite migration → spread across
  Tasks 2, 4, 8 (paired with the library file each test file covers);
  cleanup gated on live validation → Task 10; Vercel project itself →
  Task 10 Step 8, explicitly deferred to the user. All spec sections have
  a task.
- **Placeholder scan:** no TBD/TODO. Task 9's `.env` append and Step 9's
  browser walkthrough have `<value>` placeholders, but those aren't code
  placeholders — they're the specific real secrets that only the user
  can supply, called out explicitly as a blocking Step 1 rather than
  glossed over.
- **Type/name consistency:** `runReconciliation()` (Task 5) is the exact
  name both `instrumentation.js` and
  `app/api/cron/reconcile/route.js` import; `getClientIp(request)`/
  `publicOrder(order, attempt)` (Task 2) match the exact signatures used
  in Task 6/7's route handlers; every `lib/*.js` import path in Tasks
  6-7 is relative-depth-checked against the real
  `app/api/<segment>/<segment>/route.js` nesting (three or four `../`
  depending on path depth, verified per file above).
