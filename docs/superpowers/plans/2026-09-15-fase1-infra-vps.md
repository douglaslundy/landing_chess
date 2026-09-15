# Fase 1 — Infraestrutura na VPS — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up an isolated Docker + Postgres + Traefik environment on the
existing VPS (144.91.92.70), serving a minimal Next.js App Router skeleton at
`https://chess.dlsistemas.com.br` with valid TLS and a working app→Postgres
connection, without touching any other project already hosted on that VPS.

**Architecture:** A new Next.js (App Router) app lives in `web/` at the repo
root and becomes the seed of the real application built out in Fase 2 — no
throwaway code. Deployment config (`docker-compose.yml`, `.env.example`)
lives in `deploy/` at repo root, versioned but referencing a real `.env`
that only ever exists on the VPS at `/opt/xadrez-essencial/.env`, never in
git. Two containers this phase: `postgres` (internal network only) and
`app` (internal network + the VPS's existing external `proxy` network, so
the existing Traefik instance can route to it via Docker labels — no new
reverse proxy, no crontab changes, no new CI/CD).

**Tech Stack:** Next.js 15 (App Router, `output: standalone`), React 19,
`pg` for Postgres access, Vitest for unit tests, Docker multi-stage build,
Docker Compose, existing Traefik v2/v3 + Let's Encrypt on the VPS.

**Spec:** `docs/superpowers/specs/2026-09-14-fase1-infra-vps-design.md`

## Global Constraints

- Isolation: containers/networks/volumes for this project only; never
  share a process, network, or port with another project on the VPS, and
  never list/modify/remove containers that don't belong to this project.
- Never edit the shared root crontab on the VPS — scheduled jobs (Fase 2+)
  run inside the app's own process, not cron.
- Never commit real secrets or `.env` files — only `.env.example` files are
  versioned. The real VPS secrets file is `/opt/xadrez-essencial/.env`,
  permission `600`, generated at deploy time, never reused from another
  project's secrets.
- Never persist credit card data anywhere in this system (not exercised by
  this phase's skeleton, but a standing rule for the whole project).
- Never run a destructive command or any mutation on the VPS
  (`ssh root@144.91.92.70 ...` beyond read-only inspection, `docker compose
  up`, `git clone` into `/opt`, etc.) without the user's explicit
  confirmation immediately before that specific command. Task 5 below marks
  every such step.
- VPS facts: host `144.91.92.70`, user `root`. **SSH key path is not yet
  confirmed** — do not hardcode a path; reference it as the `$VPS_SSH_KEY`
  environment variable (set by whoever executes Task 5, after confirming
  the real path with the user) in every SSH/`scp` command.
- Domain: `chess.dlsistemas.com.br` must have an A record → `144.91.92.70`,
  created by the user in their DNS provider — outside this plan's scope.
  Task 5 has a fallback (`curl --resolve`) for testing before DNS
  propagates.
- Existing convention on this VPS (used by `corridas`, `mecanicapro`, etc.):
  one directory per project at `/opt/<name>/`, own `docker-compose.yml`,
  database on an internal-only network, only the publicly routed container
  joins the external `proxy` network. Official doc on the VPS itself:
  `/opt/INFRA-README.md`.

---

## File Structure

- `web/package.json` — new Next.js app manifest (ESM, `"type": "module"`).
- `web/next.config.mjs` — Next.js config, `output: 'standalone'` for a lean
  Docker image.
- `web/app/layout.js` — root layout.
- `web/app/page.js` — home page, renders a DB connectivity status string.
- `web/app/api/health/route.js` — `GET` endpoint, JSON health/DB status.
- `web/lib/db.js` — Postgres pool + `checkDatabaseConnection()`.
- `web/tests/db.test.mjs` — Vitest unit test for `checkDatabaseConnection`.
- `web/public/.gitkeep` — keeps the (currently empty) `public/` dir so the
  Dockerfile's `COPY --from=builder /app/public` step has something to copy.
- `web/.env.example` — documents `DATABASE_URL`, `DATABASE_SSL`, `PORT` for
  local dev.
- `web/Dockerfile` — multi-stage build → `next build` (standalone output) →
  minimal `node:20-alpine` runtime.
- `web/.dockerignore` — excludes `node_modules`, `.next`, `.env*`.
- `deploy/docker-compose.yml` — `postgres` + `app` services, networks,
  Traefik labels on `app`.
- `deploy/.env.example` — documents every key that must exist in the real
  `/opt/xadrez-essencial/.env` on the VPS.
- `vitest.config.mjs` (repo root) — excludes `web/**` from the root test
  run, since `web/` manages its own Vitest run via its own `package.json`.
- `.gitignore` (repo root) — add `.next/` (Next.js build output isn't
  covered by the existing `node_modules/`/`.env*` rules).
- `BACKLOG.md` — Fase 1 row flipped to done, linking this plan, once Task 5
  succeeds.

---

### Task 1: Postgres connectivity helper (`web/lib/db.js`)

**Files:**
- Create: `web/package.json`
- Create: `web/lib/db.js`
- Test: `web/tests/db.test.mjs`

**Interfaces:**
- Produces: `checkDatabaseConnection(): Promise<boolean>` — resolves `true`
  when `SELECT 1` succeeds, rejects with the underlying error otherwise.
  Consumed by Task 2 (`app/page.js`, `app/api/health/route.js`).
- Produces: `resetPoolForTests(): void` — test-only helper that clears the
  module-level pool singleton so each test gets a fresh mocked `Pool`.
- Consumes: `process.env.DATABASE_URL`, `process.env.DATABASE_SSL`.

- [ ] **Step 1: Create `web/package.json`**

```json
{
  "name": "xadrez-essencial-web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "vitest run"
  },
  "dependencies": {
    "next": "^15.5.0",
    "react": "^19.1.0",
    "react-dom": "^19.1.0",
    "pg": "^8.23.0"
  },
  "devDependencies": {
    "vitest": "^5.0.0"
  }
}
```

- [ ] **Step 2: Write the failing test**

Create `web/tests/db.test.mjs`:

```js
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();

vi.mock('pg', () => ({
  Pool: vi.fn().mockImplementation(function PoolMock() {
    return { query: queryMock };
  })
}));

const { checkDatabaseConnection, resetPoolForTests } = await import('../lib/db.js');

describe('checkDatabaseConnection', () => {
  beforeEach(() => {
    process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
    resetPoolForTests();
    queryMock.mockReset();
  });

  afterEach(() => {
    delete process.env.DATABASE_URL;
  });

  it('returns true when the database responds to SELECT 1', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ ok: 1 }] });
    await expect(checkDatabaseConnection()).resolves.toBe(true);
  });

  it('propagates the error when the database is unreachable', async () => {
    queryMock.mockRejectedValueOnce(new Error('connection refused'));
    await expect(checkDatabaseConnection()).rejects.toThrow('connection refused');
  });
});
```

- [ ] **Step 3: Install dependencies and run the test to verify it fails**

```bash
cd web
npm install
npm test
```

Expected: FAIL — `Cannot find module '../lib/db.js'` (or similar).

- [ ] **Step 4: Write the minimal implementation**

Create `web/lib/db.js`:

```js
import { Pool } from 'pg';

let pool;

function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
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

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd web
npm test
```

Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add web/package.json web/package-lock.json web/lib/db.js web/tests/db.test.mjs
git commit -m "feat(web): add Postgres connectivity helper with tests"
```

---

### Task 2: Next.js App Router skeleton (pages + health endpoint)

**Files:**
- Create: `web/next.config.mjs`
- Create: `web/app/layout.js`
- Create: `web/app/page.js`
- Create: `web/app/api/health/route.js`
- Create: `web/public/.gitkeep`
- Create: `web/.env.example`
- Create: `vitest.config.mjs` (repo root)
- Modify: `.gitignore` (repo root)

**Interfaces:**
- Consumes: `checkDatabaseConnection` from `web/lib/db.js` (Task 1).
- Produces: `GET /api/health` → `{ ok: true, db: 'connected' }` (200) or
  `{ ok: false, db: 'error', message }` (503). Used by Task 5's deploy
  verification.
- Produces: `GET /` → HTML page showing DB status text, used as the
  phase's visual success check.

- [ ] **Step 1: Add `web/next.config.mjs`**

```js
const nextConfig = {
  output: 'standalone'
};

export default nextConfig;
```

- [ ] **Step 2: Add `web/app/layout.js`**

```jsx
export const metadata = {
  title: 'Xadrez Essencial',
  description: 'Fase 1 — infraestrutura VPS'
};

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 3: Add `web/app/page.js`**

```jsx
import { checkDatabaseConnection } from '../lib/db.js';

export default async function HomePage() {
  let dbStatus = 'desconhecido';
  try {
    await checkDatabaseConnection();
    dbStatus = 'conectado';
  } catch {
    dbStatus = 'falhou';
  }

  return (
    <main style={{ fontFamily: 'system-ui', padding: '2rem' }}>
      <h1>Xadrez Essencial</h1>
      <p>Fase 1 — esqueleto Next.js rodando na VPS.</p>
      <p>Status do banco: {dbStatus}</p>
    </main>
  );
}
```

- [ ] **Step 4: Add `web/app/api/health/route.js`**

```js
import { NextResponse } from 'next/server';
import { checkDatabaseConnection } from '../../../lib/db.js';

export async function GET() {
  try {
    await checkDatabaseConnection();
    return NextResponse.json({ ok: true, db: 'connected' });
  } catch (error) {
    return NextResponse.json(
      { ok: false, db: 'error', message: error.message },
      { status: 503 }
    );
  }
}
```

- [ ] **Step 5: Add `web/public/.gitkeep`**

Empty file — keeps the directory present in git so the Dockerfile's
`COPY --from=builder /app/public ./public` step (Task 3) has a source that
exists.

- [ ] **Step 6: Add `web/.env.example`**

```
DATABASE_URL=postgres://xadrez:changeme@localhost:5432/xadrez
DATABASE_SSL=false
PORT=3000
```

- [ ] **Step 7: Keep the root test run scoped to the existing suite**

Create `vitest.config.mjs` at the repo root:

```js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', 'web/**']
  }
});
```

- [ ] **Step 8: Ignore Next.js build output**

Add to the repo-root `.gitignore`:

```
.next/
```

- [ ] **Step 9: Verify the root suite is unaffected**

```bash
npm test
```

Expected: PASS, same test count as before this task (root `tests/` only,
no `web/tests` picked up).

- [ ] **Step 10: Build the skeleton locally to verify it compiles**

```bash
cd web
npm run build
```

Expected: `next build` succeeds, prints the standalone output summary. This
is the only build verification possible in this dev environment — Docker
isn't installed here, so the containerized build is verified in Task 5 on
the VPS itself.

- [ ] **Step 11: Commit**

```bash
git add web/next.config.mjs web/app web/public/.gitkeep web/.env.example vitest.config.mjs .gitignore
git commit -m "feat(web): add Next.js App Router skeleton with health check"
```

---

### Task 3: Dockerfile for the skeleton app

**Files:**
- Create: `web/Dockerfile`
- Create: `web/.dockerignore`

**Interfaces:**
- Consumes: `web/package.json` build/start scripts (Task 1), `output:
  'standalone'` in `web/next.config.mjs` (Task 2).
- Produces: a buildable image exposing port `3000`, consumed by
  `deploy/docker-compose.yml` (Task 4) via `build: { context: ../web }`.

- [ ] **Step 1: Add `web/.dockerignore`**

```
node_modules
.next
.env
.env.local
npm-debug.log
```

- [ ] **Step 2: Add `web/Dockerfile`**

```dockerfile
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
```

- [ ] **Step 3: Commit**

```bash
git add web/Dockerfile web/.dockerignore
git commit -m "feat(web): add multi-stage Dockerfile for standalone Next.js build"
```

No local verification here: this dev environment has no Docker install.
The image build is verified for real in Task 5, Step 6, on the VPS.

---

### Task 4: Docker Compose + Traefik routing config

**Files:**
- Create: `deploy/docker-compose.yml`
- Create: `deploy/.env.example`

**Interfaces:**
- Consumes: `web/Dockerfile` (Task 3) as the `app` service's build context.
- Consumes (at deploy time only, never committed): `/opt/xadrez-essencial/.env`
  on the VPS, containing every key listed in `deploy/.env.example`.
- Produces: two services, `postgres` and `app`, on network `xadrez_internal`
  (created by this compose file) plus `app` also on the pre-existing
  external network `proxy`. Consumed by Task 5's deploy steps.

- [ ] **Step 1: Add `deploy/.env.example`**

```
POSTGRES_USER=xadrez
POSTGRES_PASSWORD=changeme
POSTGRES_DB=xadrez
DATABASE_URL=postgres://xadrez:changeme@postgres:5432/xadrez
DATABASE_SSL=false
PORT=3000
```

`POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB` must match the
credentials embedded in `DATABASE_URL` — the app connects to the `postgres`
service by its Compose service name, not `localhost`.

- [ ] **Step 2: Add `deploy/docker-compose.yml`**

```yaml
services:
  postgres:
    image: postgres:17-alpine
    container_name: xadrez-postgres
    restart: unless-stopped
    env_file:
      - /opt/xadrez-essencial/.env
    volumes:
      - xadrez_postgres_data:/var/lib/postgresql/data
    networks:
      - xadrez_internal

  app:
    build:
      context: ../web
      dockerfile: Dockerfile
    container_name: xadrez-app
    restart: unless-stopped
    env_file:
      - /opt/xadrez-essencial/.env
    depends_on:
      - postgres
    networks:
      - xadrez_internal
      - proxy
    labels:
      traefik.enable: "true"
      traefik.docker.network: "proxy"
      traefik.http.routers.xadrez-http.rule: "Host(`chess.dlsistemas.com.br`)"
      traefik.http.routers.xadrez-http.entrypoints: "web"
      traefik.http.routers.xadrez-http.middlewares: "redirect-to-https"
      traefik.http.routers.xadrez.rule: "Host(`chess.dlsistemas.com.br`)"
      traefik.http.routers.xadrez.entrypoints: "websecure"
      traefik.http.routers.xadrez.tls: "true"
      traefik.http.routers.xadrez.tls.certresolver: "letsencrypt"
      traefik.http.services.xadrez.loadbalancer.server.port: "3000"

networks:
  xadrez_internal:
    external: false
  proxy:
    external: true

volumes:
  xadrez_postgres_data:
```

The `redirect-to-https` middleware name assumes it's shared globally (as
seen on `corridas-app` during the read-only recon). Task 5, Step 3
re-confirms this on the live Traefik config before relying on it — if it
turns out to be scoped to the `corridas` project, swap both label values
here to a project-owned `xadrez-redirect-to-https` middleware, defined via
an extra label block on `app`:

```yaml
      traefik.http.middlewares.xadrez-redirect-to-https.redirectscheme.scheme: "https"
```

- [ ] **Step 3: Commit**

```bash
git add deploy/docker-compose.yml deploy/.env.example
git commit -m "feat(deploy): add Docker Compose stack with Traefik routing labels"
```

No local verification here either (no Docker locally) — `docker compose
config` validation happens as the first sub-step of Task 5's deploy.

---

### Task 5: Deploy to the VPS and verify the phase's success criteria

This task runs real commands against a shared production VPS. **Every
mutating step below is marked with a STOP — get the user's explicit
confirmation immediately before running it.** Read-only steps (recon,
`docker ps`, `cat`) don't need a stop.

Set once, in the executor's shell, after confirming the real key path with
the user (do not hardcode it anywhere in the repo):

```bash
export VPS_SSH_KEY=/path/confirmed/with/the/user
export VPS_HOST=root@144.91.92.70
alias vps-ssh="ssh -i \"$VPS_SSH_KEY\" \"$VPS_HOST\""
```

**Files:**
- Modify: `BACKLOG.md` (Fase 1 row → done, at the end of this task)
- No other repo files — this task's changes live on the VPS filesystem.

**Interfaces:**
- Consumes: `web/` (Tasks 1–3), `deploy/docker-compose.yml` +
  `deploy/.env.example` (Task 4).
- Produces: the running deployment itself — the phase's deliverable.

- [ ] **Step 1: Re-confirm the target directory is still free (read-only)**

```bash
vps-ssh "test -d /opt/xadrez-essencial && echo EXISTS || echo FREE"
```

Expected: `FREE` (confirmed clear during the 2026-09-14 recon; re-check
since time has passed — if `EXISTS`, stop and investigate before
continuing, don't overwrite).

- [ ] **Step 2: Snapshot current containers/networks (read-only, for the before/after diff)**

```bash
vps-ssh "docker ps --format '{{.Names}}'" | sort > /tmp/xadrez-before-containers.txt
vps-ssh "docker network ls --format '{{.Name}}'" | sort > /tmp/xadrez-before-networks.txt
cat /tmp/xadrez-before-containers.txt
```

- [ ] **Step 3: Confirm the `redirect-to-https` middleware's real scope (read-only)**

```bash
vps-ssh "docker inspect corridas-app --format '{{json .Config.Labels}}'" | tr ',' '\n' | grep -i middleware
```

If the middleware is defined via labels on `corridas-app` itself (not on a
shared/global dynamic config file), it's scoped to that container's router
only and won't apply to `xadrez`. In that case, edit
`deploy/docker-compose.yml` (Task 4) to add the
`xadrez-redirect-to-https` middleware block shown there, swap the two
`middlewares:`/router references to use it, and re-run this step's logic
on the new file before proceeding.

- [ ] **STOP — confirm with the user before Step 4.**

- [ ] **Step 4: Create the project directory and clone the repo**

```bash
vps-ssh "mkdir -p /opt/xadrez-essencial && cd /opt/xadrez-essencial && git clone https://github.com/douglaslundy/landing_chess.git src"
```

- [ ] **STOP — confirm with the user before Step 5.**

- [ ] **Step 5: Generate the real `.env` on the VPS**

```bash
vps-ssh "cd /opt/xadrez-essencial && \
  PG_PASSWORD=\$(openssl rand -hex 24) && \
  printf 'POSTGRES_USER=xadrez\nPOSTGRES_PASSWORD=%s\nPOSTGRES_DB=xadrez\nDATABASE_URL=postgres://xadrez:%s@postgres:5432/xadrez\nDATABASE_SSL=false\nPORT=3000\n' \"\$PG_PASSWORD\" \"\$PG_PASSWORD\" > .env && \
  chmod 600 .env"
```

Expected: `/opt/xadrez-essencial/.env` exists, mode `600`, owned by `root`.
Verify without printing the secret:

```bash
vps-ssh "stat -c '%a %U' /opt/xadrez-essencial/.env"
```

Expected: `600 root`.

- [ ] **STOP — confirm with the user before Step 6.**

- [ ] **Step 6: Build and start the stack**

```bash
vps-ssh "cd /opt/xadrez-essencial/src && docker compose -f deploy/docker-compose.yml --env-file /opt/xadrez-essencial/.env build"
vps-ssh "cd /opt/xadrez-essencial/src && docker compose -f deploy/docker-compose.yml --env-file /opt/xadrez-essencial/.env up -d"
```

- [ ] **Step 7: Verify both containers are healthy (read-only)**

```bash
vps-ssh "docker ps --filter name=xadrez"
```

Expected: `xadrez-postgres` and `xadrez-app` both `Up`.

- [ ] **Step 8: Verify app → Postgres connectivity (read-only)**

```bash
vps-ssh "docker exec xadrez-app wget -qO- http://localhost:3000/api/health"
```

Expected: `{"ok":true,"db":"connected"}`.

- [ ] **Step 9: Verify HTTPS routing and TLS**

If DNS has propagated:

```bash
curl -sI https://chess.dlsistemas.com.br | head -1
```

Expected: `HTTP/2 200`.

If DNS hasn't propagated yet, test via the VPS IP directly with SNI/Host
override instead of waiting:

```bash
curl -sI --resolve chess.dlsistemas.com.br:443:144.91.92.70 https://chess.dlsistemas.com.br | head -1
```

Expected: `HTTP/2 200` with a valid Let's Encrypt cert (no `-k` needed).

- [ ] **Step 10: Confirm isolation — no other project's containers/networks changed (read-only)**

```bash
vps-ssh "docker ps --format '{{.Names}}'" | sort > /tmp/xadrez-after-containers.txt
diff /tmp/xadrez-before-containers.txt /tmp/xadrez-after-containers.txt
```

Expected: the only diff is the two new lines, `xadrez-app` and
`xadrez-postgres`. Any other line changing means something outside this
project's scope was touched — stop and investigate before declaring the
phase done.

- [ ] **Step 11: Update the backlog**

Edit `BACKLOG.md`'s Fase 1 row:

```markdown
| 1 | Infra na VPS (recon read-only, Docker, Traefik, Postgres, rollback) | ✅ Concluída (YYYY-MM-DD) — [design](docs/superpowers/specs/2026-09-14-fase1-infra-vps-design.md), [plano](docs/superpowers/plans/2026-09-15-fase1-infra-vps.md) |
```

(Replace `YYYY-MM-DD` with the actual completion date.)

- [ ] **Step 12: Commit the backlog update**

```bash
git add BACKLOG.md
git commit -m "docs: mark Fase 1 (VPS infra) as complete"
```

---

## Self-Review Notes

- **Spec coverage:** localização/isolamento → Task 4; roteamento Traefik →
  Task 4 + Task 5 Step 3; segredos → Task 5 Step 5; deploy flow (clone,
  build, up) → Task 5 Steps 4–6; jobs agendados → explicitly out of scope
  for this phase (no real cron logic exists yet, matches spec's "fora de
  escopo: migração da lógica real"); rollback → `docker compose down`
  confined to `/opt/xadrez-essencial`, no task needed beyond documenting it
  (already true by construction — nothing outside that directory is ever
  touched except the DNS record and Traefik labels, both called out in
  Global Constraints); critério de sucesso → Task 5 Steps 8–10 check all
  three conditions (TLS + skeleton page, app↔postgres, no other container
  touched).
- **Placeholder scan:** no TBD/TODO strings; the one deliberately-unresolved
  value (`$VPS_SSH_KEY`) is called out explicitly as unresolved rather than
  faked, with an explicit resolution step before Task 5 runs.
- **Type/name consistency:** `checkDatabaseConnection` and
  `resetPoolForTests` (Task 1) are the exact names imported in Task 2's
  `page.js` and `route.js`; `DATABASE_URL`/`DATABASE_SSL` are the same
  keys across `web/.env.example`, `deploy/.env.example`, and Task 5's
  generated `.env`; the Traefik router names (`xadrez-http`, `xadrez`) and
  service name (`xadrez`) are consistent between Task 4's compose file and
  the middleware fallback discussed in Task 5 Step 3.
