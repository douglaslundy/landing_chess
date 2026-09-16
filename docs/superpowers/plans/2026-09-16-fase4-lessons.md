# Fase 4 — Aulas: CRUD no admin + área do cliente — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `lessons` table with admin CRUD (create/edit/reorder/publish/delete) and replace the client area's placeholder with a real list of published lessons, reusing all of Fase 3's session/guard/logging infrastructure unchanged.

**Architecture:** A single new lib module (`web/lib/lessons.js`) owns all `lessons` table access. Two new admin route files (list+create, and single-item update+delete) sit behind the existing `resolveSession('admin')` guard and call the existing `logAdminAction`. One new admin page (a Server Component guard wrapping a Client Component CRUD UI) and one existing client page get updated to use this lib.

**Tech Stack:** Next.js 15 (App Router, dynamic route segments with async `params`), `pg`, Zod, `vitest` — same stack as Fase 3, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-16-fase4-lessons-design.md`

## Global Constraints

- No new npm dependencies.
- Schema change via a new versioned migration (`migrations/003_lessons.sql`), matching `001_init.sql`/`002_auth.sql`'s style (lowercase, no `if not exists` needed since this is a brand-new table, index after the table).
- Every admin lessons route requires `resolveSession(token, 'admin')` — 401 JSON if missing/invalid, exactly like `web/app/api/client/set-password/route.js` already does for the client profile.
- Every successful admin mutation (create/update/delete) calls `logAdminAction(session.subject_id, action, lessonId, ip)` — this function already exists (Fase 3, `web/lib/auth/accessLog.js`) and has never been called for real until this plan.
- Route Handlers and pages are NOT unit tested directly in this codebase (confirmed convention, unchanged from Fase 3) — only `web/lib/**` and Zod schemas get dedicated tests. The `acceptance-coverage.test.mjs` source-grep safety net (added in Fase 3's final review) gets extended instead.
- Lessons are always external links (PDF or video URL) — never a file upload, per the project's fixed rule.

---

### Task 1: Migration `003_lessons.sql`

**Files:**
- Create: `migrations/003_lessons.sql`

**Interfaces:**
- Produces: table `lessons` — consumed by Task 2 (`web/lib/lessons.js`).

- [ ] **Step 1: Write the migration file**

```sql
create table lessons (
  id uuid primary key,
  title text not null,
  description text,
  content_type text not null check (content_type in ('pdf','video')),
  url text not null,
  position integer not null,
  published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index lessons_position_idx on lessons(position);
```

- [ ] **Step 2: Commit**

```bash
git add migrations/003_lessons.sql
git commit -m "feat(db): add lessons table"
```

---

### Task 2: `web/lib/lessons.js` — lessons store

**Files:**
- Create: `web/lib/lessons.js`
- Test: `web/tests/lessons.test.mjs`

**Interfaces:**
- Consumes: `query` from `web/lib/db.js`.
- Produces: `listLessons({ onlyPublished }?: { onlyPublished?: boolean }): Promise<Array<Lesson>>`,
  `getLessonById(id: string): Promise<Lesson|null>`,
  `createLesson({title, description, contentType, url, position, published}): Promise<Lesson>`,
  `updateLesson(id: string, {title, description, contentType, url, position, published}): Promise<Lesson|null>`,
  `deleteLesson(id: string): Promise<boolean>` — all consumed by Tasks 4, 5, 8.
  A `Lesson` row has the exact column names from the migration (`content_type`, not `contentType` — the DB row shape, unlike the input object shape which uses camelCase to match the Zod schema in Task 3).

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
const { listLessons, getLessonById, createLesson, updateLesson, deleteLesson } = await import('../lib/lessons.js');

describe('lessons store', () => {
  beforeEach(() => {
    process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
    resetPoolForTests();
    queryMock.mockReset();
  });

  afterEach(() => {
    delete process.env.DATABASE_URL;
  });

  it('lists only published lessons ordered by position when onlyPublished is true', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: '1', title: 'A', published: true }] });
    const rows = await listLessons({ onlyPublished: true });
    expect(rows).toEqual([{ id: '1', title: 'A', published: true }]);
    expect(queryMock).toHaveBeenCalledWith(
      'select * from lessons where published = true order by position asc',
      []
    );
  });

  it('lists all lessons (including drafts) when onlyPublished is not set', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    await listLessons();
    expect(queryMock).toHaveBeenCalledWith('select * from lessons order by position asc', []);
  });

  it('creates a lesson with a generated id', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'new-id', title: 'Volume 1' }] });
    const lesson = await createLesson({
      title: 'Volume 1',
      contentType: 'pdf',
      url: 'https://example.com/v1.pdf',
      position: 10,
      published: true
    });
    expect(lesson).toEqual({ id: 'new-id', title: 'Volume 1' });
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toContain('insert into lessons');
    expect(params).toEqual([expect.any(String), 'Volume 1', null, 'pdf', 'https://example.com/v1.pdf', 10, true]);
  });

  it('updates a lesson by id and returns the updated row', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'id-1', title: 'Updated' }] });
    const lesson = await updateLesson('id-1', {
      title: 'Updated',
      contentType: 'video',
      url: 'https://youtube.com/x',
      position: 20,
      published: false
    });
    expect(lesson).toEqual({ id: 'id-1', title: 'Updated' });
  });

  it('returns null when updating a lesson that does not exist', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    await expect(
      updateLesson('missing', { title: 'x', contentType: 'pdf', url: 'https://x.com', position: 1, published: true })
    ).resolves.toBeNull();
  });

  it('deletes a lesson and reports true when a row was removed', async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 1 });
    await expect(deleteLesson('id-1')).resolves.toBe(true);
  });

  it('reports false when deleting a lesson that does not exist', async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 0 });
    await expect(deleteLesson('missing')).resolves.toBe(false);
  });

  it('gets a lesson by id, or null when not found', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'id-1' }] });
    await expect(getLessonById('id-1')).resolves.toEqual({ id: 'id-1' });
    queryMock.mockResolvedValueOnce({ rows: [] });
    await expect(getLessonById('missing')).resolves.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run tests/lessons.test.mjs`
Expected: FAIL — `Cannot find module '../lib/lessons.js'`

- [ ] **Step 3: Write the implementation**

```js
import crypto from 'node:crypto';
import { query } from './db.js';

function uuid() {
  return crypto.randomUUID();
}

export async function listLessons({ onlyPublished = false } = {}) {
  const result = onlyPublished
    ? await query('select * from lessons where published = true order by position asc', [])
    : await query('select * from lessons order by position asc', []);
  return result.rows;
}

export async function getLessonById(id) {
  const result = await query('select * from lessons where id = $1', [id]);
  return result.rows[0] || null;
}

export async function createLesson({ title, description, contentType, url, position, published }) {
  const result = await query(
    `insert into lessons (id, title, description, content_type, url, position, published)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning *`,
    [uuid(), title, description || null, contentType, url, position, published ?? true]
  );
  return result.rows[0];
}

export async function updateLesson(id, { title, description, contentType, url, position, published }) {
  const result = await query(
    `update lessons set
       title = $2,
       description = $3,
       content_type = $4,
       url = $5,
       position = $6,
       published = $7,
       updated_at = now()
     where id = $1
     returning *`,
    [id, title, description || null, contentType, url, position, published ?? true]
  );
  return result.rows[0] || null;
}

export async function deleteLesson(id) {
  const result = await query('delete from lessons where id = $1', [id]);
  return result.rowCount > 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run tests/lessons.test.mjs`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add web/lib/lessons.js web/tests/lessons.test.mjs
git commit -m "feat(web): add lessons store (list/get/create/update/delete)"
```

---

### Task 3: `lessonSchema`

**Files:**
- Modify: `web/lib/schemas.js`
- Test: `web/tests/lesson-schema.test.mjs`

**Interfaces:**
- Produces: `lessonSchema` (Zod) — consumed by Tasks 4 and 5.

- [ ] **Step 1: Write the failing test**

```js
import { describe, expect, it } from 'vitest';
import { lessonSchema } from '../lib/schemas.js';

describe('lessonSchema', () => {
  it('accepts a valid lesson payload and defaults published to true', () => {
    const parsed = lessonSchema.parse({
      title: 'Volume 1',
      contentType: 'pdf',
      url: 'https://example.com/v1.pdf',
      position: 10
    });
    expect(parsed.published).toBe(true);
    expect(parsed.title).toBe('Volume 1');
  });

  it('rejects an invalid contentType', () => {
    expect(() =>
      lessonSchema.parse({ title: 'x', contentType: 'audio', url: 'https://x.com', position: 1 })
    ).toThrow();
  });

  it('rejects an invalid url', () => {
    expect(() =>
      lessonSchema.parse({ title: 'x', contentType: 'pdf', url: 'not-a-url', position: 1 })
    ).toThrow();
  });

  it('coerces position to a number', () => {
    const parsed = lessonSchema.parse({
      title: 'x',
      contentType: 'pdf',
      url: 'https://x.com',
      position: '20'
    });
    expect(parsed.position).toBe(20);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run tests/lesson-schema.test.mjs`
Expected: FAIL — `lessonSchema` not exported yet

- [ ] **Step 3: Add the schema**

Append to `web/lib/schemas.js`:

```js
export const lessonSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional().or(z.literal('')),
  contentType: z.enum(['pdf', 'video']),
  url: z.string().trim().url().max(2000),
  position: z.coerce.number().int(),
  published: z.boolean().optional().default(true)
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run tests/lesson-schema.test.mjs`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add web/lib/schemas.js web/tests/lesson-schema.test.mjs
git commit -m "feat(web): add lesson validation schema"
```

---

### Task 4: Admin lessons list/create route

**Files:**
- Create: `web/app/api/admin/lessons/route.js`

**Interfaces:**
- Consumes: `resolveSession` (`web/lib/auth/guard.js`), `ADMIN_COOKIE` (`web/lib/auth/cookies.js`),
  `logAdminAction` (`web/lib/auth/accessLog.js`), `getClientIp` (`web/lib/http.js`),
  `lessonSchema` (`web/lib/schemas.js`), `listLessons`/`createLesson` (`web/lib/lessons.js`).
- Produces: `GET /api/admin/lessons` (returns `{ lessons }`, all rows including drafts),
  `POST /api/admin/lessons` (creates, returns `{ lesson }` — consumed by Task 6's admin UI).

No dedicated test file (route handlers aren't unit tested in this codebase — see Global Constraints). Verified in Task 10.

- [ ] **Step 1: Create the route**

`web/app/api/admin/lessons/route.js`:

```js
import { NextResponse } from 'next/server';
import { getClientIp } from '../../../../lib/http.js';
import { resolveSession } from '../../../../lib/auth/guard.js';
import { logAdminAction } from '../../../../lib/auth/accessLog.js';
import { ADMIN_COOKIE } from '../../../../lib/auth/cookies.js';
import { lessonSchema } from '../../../../lib/schemas.js';
import { listLessons, createLesson } from '../../../../lib/lessons.js';

export async function GET(request) {
  const token = request.cookies.get(ADMIN_COOKIE)?.value || null;
  const session = await resolveSession(token, 'admin');
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  try {
    const lessons = await listLessons();
    return NextResponse.json({ lessons });
  } catch (error) {
    console.error('[api/admin/lessons GET] failed:', error);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}

export async function POST(request) {
  const token = request.cookies.get(ADMIN_COOKIE)?.value || null;
  const session = await resolveSession(token, 'admin');
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  try {
    let raw;
    try { raw = await request.json(); } catch { raw = {}; }
    const data = lessonSchema.parse(raw);
    const lesson = await createLesson(data);
    await logAdminAction(session.subject_id, 'create_lesson', lesson.id, getClientIp(request));
    return NextResponse.json({ lesson }, { status: 201 });
  } catch (error) {
    if (error.name === 'ZodError') {
      return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
    }
    console.error('[api/admin/lessons POST] failed:', error);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add web/app/api/admin/lessons/route.js
git commit -m "feat(web): add admin lessons list/create route"
```

---

### Task 5: Admin single-lesson update/delete route

**Files:**
- Create: `web/app/api/admin/lessons/[id]/route.js`

**Interfaces:**
- Consumes: same as Task 4, plus `updateLesson`/`deleteLesson` (`web/lib/lessons.js`).
- Produces: `PATCH /api/admin/lessons/:id`, `DELETE /api/admin/lessons/:id` — consumed by Task 6.

Next.js 15 route handlers receive dynamic segments as an async `params` object —
`{ id } = await params`, not a plain destructure. No dedicated test file (see
Global Constraints). Verified in Task 10.

- [ ] **Step 1: Create the route**

`web/app/api/admin/lessons/[id]/route.js`:

```js
import { NextResponse } from 'next/server';
import { getClientIp } from '../../../../../lib/http.js';
import { resolveSession } from '../../../../../lib/auth/guard.js';
import { logAdminAction } from '../../../../../lib/auth/accessLog.js';
import { ADMIN_COOKIE } from '../../../../../lib/auth/cookies.js';
import { lessonSchema } from '../../../../../lib/schemas.js';
import { updateLesson, deleteLesson } from '../../../../../lib/lessons.js';

export async function PATCH(request, { params }) {
  const token = request.cookies.get(ADMIN_COOKIE)?.value || null;
  const session = await resolveSession(token, 'admin');
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  try {
    const { id } = await params;
    let raw;
    try { raw = await request.json(); } catch { raw = {}; }
    const data = lessonSchema.parse(raw);
    const lesson = await updateLesson(id, data);
    if (!lesson) return NextResponse.json({ error: 'lesson_not_found' }, { status: 404 });
    await logAdminAction(session.subject_id, 'update_lesson', id, getClientIp(request));
    return NextResponse.json({ lesson });
  } catch (error) {
    if (error.name === 'ZodError') {
      return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
    }
    console.error('[api/admin/lessons/[id] PATCH] failed:', error);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  const token = request.cookies.get(ADMIN_COOKIE)?.value || null;
  const session = await resolveSession(token, 'admin');
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  try {
    const { id } = await params;
    const deleted = await deleteLesson(id);
    if (!deleted) return NextResponse.json({ error: 'lesson_not_found' }, { status: 404 });
    await logAdminAction(session.subject_id, 'delete_lesson', id, getClientIp(request));
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[api/admin/lessons/[id] DELETE] failed:', error);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add "web/app/api/admin/lessons/[id]/route.js"
git commit -m "feat(web): add admin lesson update/delete route"
```

---

### Task 6: Admin aulas page (guard + CRUD UI)

**Files:**
- Create: `web/app/admin/aulas/page.js`
- Create: `web/app/admin/aulas/AulasManager.js`

**Interfaces:**
- Consumes: `resolveSession` (`web/lib/auth/guard.js`), `ADMIN_COOKIE` (`web/lib/auth/cookies.js`),
  `GET/POST /api/admin/lessons`, `PATCH/DELETE /api/admin/lessons/:id` (Tasks 4-5).

No dedicated test (no React component testing tool configured in this codebase,
same as every other page in Fases 3-4). Verified in Task 10.

- [ ] **Step 1: Create the CRUD client component**

`web/app/admin/aulas/AulasManager.js`:

```jsx
'use client';
import { useEffect, useState } from 'react';

const EMPTY_FORM = { title: '', description: '', contentType: 'pdf', url: '', position: 10, published: true };

export default function AulasManager() {
  const [lessons, setLessons] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState(null);

  async function loadLessons() {
    const response = await fetch('/api/admin/lessons');
    if (response.ok) {
      const body = await response.json();
      setLessons(body.lessons);
    }
  }

  useEffect(() => {
    loadLessons();
  }, []);

  function startEdit(lesson) {
    setEditingId(lesson.id);
    setForm({
      title: lesson.title,
      description: lesson.description || '',
      contentType: lesson.content_type,
      url: lesson.url,
      position: lesson.position,
      published: lesson.published
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(EMPTY_FORM);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    const payload = { ...form, position: Number(form.position) };
    const endpoint = editingId ? `/api/admin/lessons/${editingId}` : '/api/admin/lessons';
    const method = editingId ? 'PATCH' : 'POST';
    const response = await fetch(endpoint, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      setError('Não foi possível salvar a aula. Confira os campos.');
      return;
    }
    cancelEdit();
    await loadLessons();
  }

  async function handleDelete(id) {
    await fetch(`/api/admin/lessons/${id}`, { method: 'DELETE' });
    await loadLessons();
  }

  return (
    <main style={{ padding: 32, fontFamily: 'sans-serif', maxWidth: 720 }}>
      <h1>Aulas</h1>

      <form onSubmit={handleSubmit}>
        <h2>{editingId ? 'Editar aula' : 'Nova aula'}</h2>
        <label>
          Título
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
        </label>
        <label>
          Descrição
          <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </label>
        <label>
          Tipo
          <select value={form.contentType} onChange={(e) => setForm({ ...form, contentType: e.target.value })}>
            <option value="pdf">PDF</option>
            <option value="video">Vídeo</option>
          </select>
        </label>
        <label>
          URL
          <input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} required />
        </label>
        <label>
          Posição
          <input
            type="number"
            value={form.position}
            onChange={(e) => setForm({ ...form, position: e.target.value })}
            required
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={form.published}
            onChange={(e) => setForm({ ...form, published: e.target.checked })}
          />
          Publicada
        </label>
        {error && <p role="alert">{error}</p>}
        <button type="submit">{editingId ? 'Salvar' : 'Criar'}</button>
        {editingId && <button type="button" onClick={cancelEdit}>Cancelar</button>}
      </form>

      <h2>Lista</h2>
      <ul>
        {lessons.map((lesson) => (
          <li key={lesson.id}>
            <strong>{lesson.position}</strong> — {lesson.title} ({lesson.content_type}
            {lesson.published ? '' : ', rascunho'})
            <button type="button" onClick={() => startEdit(lesson)}>Editar</button>
            <button type="button" onClick={() => handleDelete(lesson.id)}>Excluir</button>
          </li>
        ))}
      </ul>
    </main>
  );
}
```

- [ ] **Step 2: Create the protected page wrapper**

`web/app/admin/aulas/page.js`:

```jsx
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ADMIN_COOKIE } from '../../../lib/auth/cookies.js';
import { resolveSession } from '../../../lib/auth/guard.js';
import AulasManager from './AulasManager.js';

export default async function AdminAulasPage() {
  const jar = await cookies();
  const token = jar.get(ADMIN_COOKIE)?.value || null;
  const session = await resolveSession(token, 'admin');
  if (!session) redirect('/admin/login');

  return <AulasManager />;
}
```

- [ ] **Step 3: Run the full test suite to confirm nothing broke**

Run: `cd web && npx vitest run`
Expected: all tests still pass (no test targets these new files directly).

- [ ] **Step 4: Commit**

```bash
git add web/app/admin/aulas
git commit -m "feat(web): add admin lessons CRUD page"
```

---

### Task 7: Link `/admin` to `/admin/aulas`

**Files:**
- Modify: `web/app/admin/page.js`

**Interfaces:**
- No new interfaces — this task only edits existing JSX.

- [ ] **Step 1: Add the link, remove the placeholder text**

In `web/app/admin/page.js`, add `import Link from 'next/link';` to the imports,
and replace:

```jsx
      <h1>Painel admin</h1>
      <p>Em construção.</p>
      <LogoutButton endpoint="/api/admin/logout" redirectTo="/admin/login" />
```

with:

```jsx
      <h1>Painel admin</h1>
      <p><Link href="/admin/aulas">Gerenciar aulas</Link></p>
      <LogoutButton endpoint="/api/admin/logout" redirectTo="/admin/login" />
```

- [ ] **Step 2: Commit**

```bash
git add web/app/admin/page.js
git commit -m "feat(web): link admin home to the lessons CRUD page"
```

---

### Task 8: Replace the client placeholder with a real lessons list

**Files:**
- Modify: `web/app/cliente/page.js`

**Interfaces:**
- Consumes: `listLessons` (`web/lib/lessons.js`, Task 2).

- [ ] **Step 1: Replace the placeholder content**

In `web/app/cliente/page.js`, add `import { listLessons } from '../../lib/lessons.js';`
to the imports, and replace:

```jsx
  return (
    <main style={{ padding: 32, fontFamily: 'sans-serif' }}>
      <h1>Área do cliente</h1>
      <p>Em construção.</p>
      <SetPasswordForm />
      <LogoutButton endpoint="/api/client/logout" redirectTo="/cliente/entrar" />
    </main>
  );
```

with:

```jsx
  const lessons = await listLessons({ onlyPublished: true });

  return (
    <main style={{ padding: 32, fontFamily: 'sans-serif' }}>
      <h1>Suas aulas</h1>
      <ul>
        {lessons.map((lesson) => (
          <li key={lesson.id}>
            <a href={lesson.url} target="_blank" rel="noreferrer">{lesson.title}</a>
            {lesson.description && <p>{lesson.description}</p>}
          </li>
        ))}
      </ul>
      <SetPasswordForm />
      <LogoutButton endpoint="/api/client/logout" redirectTo="/cliente/entrar" />
    </main>
  );
```

(`listLessons` is called before the `return`, inside the same `async function
ClientHomePage()` — right after the existing `resolveSession` guard, not
before it.)

- [ ] **Step 2: Run the full test suite to confirm nothing broke**

Run: `cd web && npx vitest run`
Expected: all tests still pass.

- [ ] **Step 3: Commit**

```bash
git add web/app/cliente/page.js
git commit -m "feat(web): show real published lessons on the client home page"
```

---

### Task 9: Extend the route-protection test safety net

**Files:**
- Modify: `web/tests/acceptance-coverage.test.mjs`

**Interfaces:**
- No new interfaces — extends the existing `'auth route protection safeguards'`
  describe block added during Fase 3's final review fix wave.

- [ ] **Step 1: Add lesson route reads and assertions**

In `web/tests/acceptance-coverage.test.mjs`, inside the existing `describe('auth
route protection safeguards', ...)` block, add two more `fs.readFileSync` reads
near the top of that block (alongside the existing ones for
`adminLoginRoute`, `clientLoginRoute`, etc.):

```js
  const adminLessonsRoute = fs.readFileSync(path.join(process.cwd(), 'app', 'api', 'admin', 'lessons', 'route.js'), 'utf8');
  const adminLessonDetailRoute = fs.readFileSync(path.join(process.cwd(), 'app', 'api', 'admin', 'lessons', '[id]', 'route.js'), 'utf8');
```

Then extend the existing test `'protects every admin/client protected page and
sensitive route behind resolveSession'` (don't create a new `it` block — add
to the existing one) with:

```js
    expect(adminLessonsRoute).toContain('resolveSession');
    expect(adminLessonDetailRoute).toContain('resolveSession');
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `cd web && npx vitest run tests/acceptance-coverage.test.mjs`
Expected: PASS

- [ ] **Step 3: Run the full test suite**

Run: `cd web && npx vitest run`
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add web/tests/acceptance-coverage.test.mjs
git commit -m "test(web): extend route-protection safety net to admin lessons routes"
```

---

### Task 10: Deploy and verify end-to-end

**Files:** none (operational task against the VPS).

- [ ] **Step 1: Run the full local test suite**

Run: `cd web && npx vitest run`
Expected: all tests pass, including every test file added in Tasks 2-3 and
the extension in Task 9.

- [ ] **Step 2: Push and sync the VPS checkout**

```bash
git push origin main
ssh -i "$VPS_SSH_KEY" "$VPS_HOST" "cd /opt/xadrez-essencial/src && git pull"
```

- [ ] **Step 3: Apply the new migration on the VPS**

```bash
cat migrations/003_lessons.sql | ssh -i "$VPS_SSH_KEY" "$VPS_HOST" \
  "docker exec -i xadrez-postgres psql -U xadrez -d xadrez"
ssh -i "$VPS_SSH_KEY" "$VPS_HOST" \
  "docker exec xadrez-postgres psql -U xadrez -d xadrez -c \"insert into schema_migrations (filename) values ('003_lessons.sql') on conflict do nothing;\""
```

Expected: no SQL errors; `schema_migrations` now lists `001_init.sql`,
`002_auth.sql`, `003_lessons.sql`.

- [ ] **Step 4: Rebuild and restart the app container**

```bash
ssh -i "$VPS_SSH_KEY" "$VPS_HOST" \
  "cd /opt/xadrez-essencial/src && docker compose -f deploy/docker-compose.yml --env-file /opt/xadrez-essencial/.env build app"
ssh -i "$VPS_SSH_KEY" "$VPS_HOST" \
  "cd /opt/xadrez-essencial/src && docker compose -f deploy/docker-compose.yml --env-file /opt/xadrez-essencial/.env up -d app"
```

- [ ] **Step 5: Verify the admin CRUD flow**

- Log in at `/admin/login` with the existing seeded admin account, click
  "Gerenciar aulas" on `/admin`.
- Create a lesson (e.g. title "Volume 1 — Teste", type PDF, a real or
  placeholder URL, position 10, published checked). Confirm it appears in
  the list immediately.
- Edit it (change the title), confirm the change is reflected.
- Toggle "Publicada" off, save, and confirm (via the client check in Step 6)
  that it no longer appears there.
- Delete the test lesson at the end of this verification.

- [ ] **Step 6: Verify the client-facing list**

- With an existing client session (from Fase 3's verification, or create a
  fresh one via magic link / password login), visit `/cliente`.
- Confirm published lessons appear as clickable links, unpublished ones do
  not.

- [ ] **Step 7: Verify admin action logging**

```bash
ssh -i "$VPS_SSH_KEY" "$VPS_HOST" \
  "docker exec xadrez-postgres psql -U xadrez -d xadrez -c \"select event, detail, created_at from access_log where event = 'admin_action' order by created_at desc limit 10;\""
```

Expected: rows for `create_lesson`, `update_lesson`, `delete_lesson` from
Step 5's verification, each with the lesson id in `detail`.

- [ ] **Step 8: Update the backlog**

Edit `BACKLOG.md`: mark Fase 4 as done (linking this spec/plan), and adjust
the Fase 5 row to note that the lesson-CRUD slice has already shipped as
part of Fase 4, leaving only dashboard/general-settings scope for a future
Fase 5.

- [ ] **Step 9: Commit the backlog update**

```bash
git add BACKLOG.md
git commit -m "docs: mark Fase 4 (lessons CRUD + client area) as deployed and verified"
git push origin main
ssh -i "$VPS_SSH_KEY" "$VPS_HOST" "cd /opt/xadrez-essencial/src && git pull"
```

## Self-review notes

- Spec coverage: schema (Task 1), lib + validation (Tasks 2-3), admin CRUD
  routes (Tasks 4-5), admin UI (Task 6), navigation link (Task 7), client
  display (Task 8), test safety net (Task 9), deploy + verification
  (Task 10) — all spec sections covered.
- Function names/signatures stay consistent across tasks: `listLessons`,
  `getLessonById`, `createLesson`, `updateLesson`, `deleteLesson` are
  defined once in Task 2 and used with the same names/argument shapes in
  Tasks 4, 5, 8.
- Import path depths verified by hand: Task 4/7's files are 4 directories
  under `web/app/` (`../../../../lib/...`); Task 5's `[id]/route.js` is 5
  deep (`../../../../../lib/...`); Task 6's `page.js` is 3 deep
  (`../../../lib/...`) and `AulasManager.js` needs no lib imports at all
  (pure fetch-based client component).
- Out of scope, unchanged from the spec: dashboard/metrics, general
  DB-backed settings, file uploads, and any change to authentication.
