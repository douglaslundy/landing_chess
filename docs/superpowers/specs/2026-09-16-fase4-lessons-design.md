# Fase 4 — Aulas: CRUD no admin + área do cliente

Status: aprovado, aguardando geração do plano de implementação.
Depende de: Fase 3 (autenticação) — concluída, revisada e verificada em
produção. Reaproveita `resolveSession`, `logAdminAction`, os placeholders
`web/app/admin/page.js` e `web/app/cliente/page.js`, e todo o padrão de
rotas/testes já estabelecido.
Escopo: combina o que o backlog descrevia como "conteúdo real da área do
cliente" (Fase 4) com a fatia de "CRUD de aulas" da Fase 5 — decisão
tomada nesta sessão porque não fazia sentido entregar a página do cliente
sem nenhuma forma real de cadastrar o que ela mostra. O resto da Fase 5
(dashboard de métricas, configurações gerais em banco) continua fora
deste spec, para um incremento futuro separado.

## Contexto do projeto (para sessões futuras sem histórico da conversa)

- Produto hoje é entregue como um único `PRODUCT_ACCESS_URL` por e-mail
  (10 volumes em PDF, ver `web/lib/constants.js`'s `PRODUCT`). Decisão
  desta sessão: as "aulas" da área do cliente **são** esses 10 volumes —
  cada um vira uma aula com seu próprio link (podem repetir o mesmo link
  ou ter links diferentes por volume; quem decide é o admin ao
  cadastrar). Não é um produto/conteúdo novo e separado do PDF.
- Identidade do cliente continua sendo a sessão criada na Fase 3 (magic
  link ou e-mail+senha) — nenhuma mudança na autenticação. Uma limitação
  já conhecida e conscientemente adiada da Fase 3 permanece: login por
  senha do cliente não reconfere `orders.status = 'paid'` no momento do
  login (ver `BACKLOG.md`, Fase 3).
- Admin único, mesma conta já existente (`admin_users`, seedada via
  `scripts/create-admin.mjs`). Nenhuma mudança em contas de admin.

## Design

### Schema (`migrations/003_lessons.sql`)

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

- `position`: inteiro simples controlando a ordem de exibição para o
  cliente (menor primeiro). Sem necessidade de ser único/sequencial —
  o admin pode usar espaçamento (10, 20, 30...) para inserir no meio sem
  renumerar tudo.
- `published`: permite cadastrar uma aula em rascunho sem mostrá-la
  ainda ao cliente.
- `content_type`: só dois valores por enquanto (`pdf`, `video`) — usado
  apenas para exibir um ícone/rótulo diferente no cliente, não muda o
  comportamento do link em si (é sempre um link externo).

### Estrutura de arquivos (novo em `web/`)

- `web/lib/lessons.js` — `listLessons({ onlyPublished })`,
  `getLessonById(id)`, `createLesson(data)`, `updateLesson(id, data)`,
  `deleteLesson(id)`. Todas via `query`/`withTransaction` de
  `web/lib/db.js`, mesmo padrão de `web/lib/orders.js`.
- `web/lib/schemas.js` — adiciona `lessonSchema` (Zod): `title`
  (string, 1-200), `description` (string opcional, até 2000),
  `contentType` (`'pdf'|'video'`), `url` (string, url válida, até
  2000), `position` (int), `published` (boolean, default true).
- `web/app/api/admin/lessons/route.js` — `GET` (lista todas, publicadas
  ou não — só admin vê rascunho), `POST` (cria).
- `web/app/api/admin/lessons/[id]/route.js` — `PATCH` (atualiza),
  `DELETE` (remove). Ambas protegidas por `resolveSession(token,
  'admin')` (mesmo padrão de `web/app/api/client/set-password/route.js`
  da Fase 3), e cada mutação bem-sucedida chama
  `logAdminAction(session.subject_id, action, detail, ip)` — a função já
  existe desde a Fase 3 (`web/lib/auth/accessLog.js`) e nunca foi usada
  de verdade até agora.
- `web/app/admin/aulas/page.js` — página protegida (mesmo guard de
  `web/app/admin/page.js`): lista as aulas (título, tipo, posição,
  publicada/rascunho) com botões editar/excluir, e um formulário de
  criar/editar. Client Component (`'use client'`) com fetch, seguindo o
  mesmo estilo das páginas de login já existentes.
- `web/app/admin/page.js` — ganha um link para `/admin/aulas` (o
  "painel admin" deixa de ser só um placeholder "em construção").
- `web/app/cliente/page.js` — troca o texto "Em construção" por uma
  lista real das aulas publicadas (`listLessons({ onlyPublished: true
  })`), ordenadas por `position`, cada uma como um link `<a>` com título
  e (se houver) descrição. Continua Server Component, guard de sessão
  inalterado.

### Testes

- `web/tests/lessons.test.mjs` — testa `web/lib/lessons.js` com o mesmo
  mock de `pg` já usado em `session.test.mjs`/`magicLink.test.mjs`:
  criar, listar (com e sem filtro de publicada), atualizar, excluir.
- `web/tests/schemas` (extensão de arquivo existente ou novo) — valida
  `lessonSchema`: rejeita `contentType` fora de `pdf`/`video`, rejeita
  `url` inválida, aceita `published` ausente com default `true`.
- Rotas de admin de aulas seguem a convenção já estabelecida na Fase 3:
  sem teste dedicado de `route.js` (nenhuma rota tem, verificado); a
  rede de proteção em `web/tests/acceptance-coverage.test.mjs` ganha
  mais uma asserção: `web/app/api/admin/lessons/route.js` e
  `web/app/api/admin/lessons/[id]/route.js` contêm `resolveSession`.
- `web/app/admin/page.js` e `web/app/cliente/page.js` continuam sem
  teste de renderização (sem ferramenta de teste de componente React
  configurada, mesma limitação já documentada na Fase 3).

### Critério de sucesso da fase

- Admin logado consegue, em `/admin/aulas`: criar uma aula, editá-la,
  marcar como rascunho/publicada, reordenar (mudando `position`) e
  excluir — tudo refletido no banco e no log de ações admin
  (`access_log`, `event = 'admin_action'`).
- Cliente logado vê em `/cliente` a lista de aulas publicadas, na ordem
  certa, cada uma com um link funcional.
- Aula marcada como rascunho não aparece para o cliente, mesmo que já
  exista no banco.
- Todos os testes novos passam (`cd web && npx vitest run`).

## Fora de escopo nesta fase

- Dashboard de métricas do painel admin (Fase 5, se/quando desenhada).
- Configurações gerais em banco (ex.: preço do produto editável pelo
  admin) — Fase 5.
- Upload de arquivo — aulas continuam sendo só links externos, nunca
  arquivo hospedado no projeto (regra fixa do backlog).
- Qualquer mudança em autenticação, sessão ou no fluxo de compra —
  nada aqui toca a Fase 2 ou a Fase 3.
