# Fase 3 — Autenticação (admin + cliente) + log de acesso

Status: aprovado, aguardando geração do plano de implementação.
Depende de: Fase 2 (migração para Next.js na VPS) — código completo e
revisado; deploy no ar em `https://chess.dlsistemas.com.br`. Checkout real
(Task 9) ainda pendente de credenciais reais no `.env` da VPS, mas isso não
bloqueia esta fase (auth não depende de pagamento real acontecer).
Bloqueia: Fase 4 (área do cliente) e Fase 5 (painel admin), que assumem o
mecanismo de login e o middleware de proteção de rotas já prontos — essas
fases só constroem conteúdo *dentro* da área já protegida.

## Contexto do projeto (para sessões futuras sem histórico da conversa)

Este spec cobre só a Fase 3 do backlog em `BACKLOG.md` (raiz do repo).
Decisões de arquitetura já fechadas para o projeto inteiro, relevantes
aqui:

- App único em Next.js App Router (`web/`), sem ORM — acesso a Postgres
  via `pg` cru (`web/lib/db.js`, `query`/`withTransaction`).
- Toda mudança de schema via migration versionada em `migrations/`
  (`001_init.sql` já existe — esta fase adiciona `002_auth.sql`).
- Nunca editar o crontab root da VPS (compartilhado com outros
  projetos) — qualquer limpeza periódica roda dentro do próprio
  processo da aplicação, reaproveitando o cron já existente
  (`web/app/api/cron/reconcile`), não um cron novo.
- Nunca persistir dado de cartão de crédito — não relevante aqui, mas
  vale o princípio geral: nunca persistir segredo em texto puro (senha
  sempre hasheada).

Decisões tomadas nesta sessão de brainstorming (2026-09-16), específicas
desta fase:

- **Dois perfis de autenticação, sessões separadas**: admin e cliente
  usam a mesma mecânica de sessão (tabela `sessions` + cookie httpOnly
  com token opaco), mas cookies diferentes (`admin_session` /
  `client_session`) para não colidir no mesmo navegador.
- **Admin**: tabela `admin_users` (email + hash de senha). Sem cadastro
  pela UI — a conta é criada por script/seed rodado manualmente na VPS.
- **Cliente não tem tabela de "usuário" própria**: a identidade do
  cliente é o `orders.buyer_email` de um pedido com `status = 'paid'`.
  Uma tabela `client_credentials` guarda senha opcional, ligada por
  email, só criada quando o cliente decide definir uma senha.
- **Acesso do cliente é por magic link como caminho principal**: ao
  confirmar pagamento, o e-mail de confirmação passa a incluir também um
  link de login de uso único e validade curta. Senha é sempre opcional
  — um atalho que o cliente pode ativar depois, dentro da área já
  logada, para não depender de e-mail em acessos futuros.
- **Hash de senha com `scrypt` nativo do Node** (`node:crypto`), sem
  dependência nova (nem `bcrypt` nem `argon2`) — mesmo princípio de
  minimizar dependências que o resto do projeto já segue.
- **Sessão sempre com estado no Postgres** (tabela `sessions`, token
  opaco), nunca JWT/cookie assinado stateless — permite revogar uma
  sessão antes do prazo (ex.: dispositivo perdido) sem precisar de
  blocklist.
- **Log de acesso cobre login/logout + ações admin sensíveis**, não
  cada acesso de página/aula — evita volume de dados sem valor de
  auditoria.
- **Esta fase entrega UI mínima de login** (não só o mecanismo): páginas
  de login admin e cliente, e uma página protegida vazia de cada lado
  para validar o fluxo ponta a ponta. Fases 4/5 só preenchem o
  *conteúdo* dentro dessa área já protegida.

## O que já existe (Fase 2, não mexer na estrutura, só estender)

- `web/app/api/*` — rotas de checkout/webhook/cron já em produção.
- `web/lib/db.js` — pool Postgres, `query`/`withTransaction`.
- `web/lib/env.js` — helpers `required`/`optional`, `serverConfig()`
  etc. — esta fase adiciona variáveis aqui, não cria um arquivo de env
  paralelo.
- `web/lib/rate-limit.js` — rate limit baseado na tabela
  `request_limits`, já usado no checkout. Reaproveitado aqui para
  login e reenvio de magic link.
- `web/lib/email.js` — envio SMTP + outbox de e-mail (`outbox_emails`).
  O e-mail de confirmação de compra (dentro do fluxo de webhook) é o
  ponto onde o magic link passa a ser incluído.
- `web/lib/reconcile.js` + `web/app/api/cron/reconcile` — cron interno
  já rodando periodicamente; ganha uma chamada a
  `cleanupExpiredSessions()` nesta fase.
- `migrations/001_init.sql` — schema atual (`orders`,
  `payment_attempts`, `webhook_events`, `outbox_emails`,
  `provider_events`, `request_limits`).
- `web/tests/` — testes `vitest` de `web/lib/*`.

## Design

### Schema (`migrations/002_auth.sql`)

```sql
create table admin_users (
  id uuid primary key,
  email text not null unique,
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table client_credentials (
  email text primary key,        -- lowercased, mesmo valor de orders.buyer_email
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table sessions (
  token text primary key,        -- opaco, crypto.randomBytes(32).toString('base64url')
  subject_type text not null check (subject_type in ('admin','client')),
  subject_id text not null,      -- admin_users.id (uuid) OU email (client)
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index sessions_expires_idx on sessions(expires_at);

create table magic_links (
  token text primary key,        -- opaco, uso único
  email text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index magic_links_email_idx on magic_links(email, created_at desc);

create table access_log (
  id uuid primary key,
  subject_type text not null check (subject_type in ('admin','client')),
  subject_id text,               -- null se falha de login (email não encontrado)
  event text not null check (event in ('login_success','login_failure','logout','admin_action')),
  detail text,
  ip text,
  created_at timestamptz not null default now()
);
create index access_log_created_idx on access_log(created_at desc);
```

### Estrutura de arquivos (novo em `web/`)

- `web/lib/auth/password.js` — `hashPassword(plain)`,
  `verifyPassword(plain, hash)` via `node:crypto` `scrypt` (salt
  aleatório embutido no hash armazenado, formato `salt:hash` em hex).
- `web/lib/auth/session.js` — `createSession(subjectType, subjectId, ttl)`,
  `getSession(token)`, `destroySession(token)`,
  `cleanupExpiredSessions()`.
- `web/lib/auth/magicLink.js` — `createMagicLink(email)`,
  `consumeMagicLink(token)` (valida existência, não-expirado,
  não-usado; marca `used_at` na mesma transação que cria a sessão, para
  não permitir replay em corrida).
- `web/lib/auth/accessLog.js` — `logAccess({subjectType, subjectId, event, detail, ip})`,
  `logAdminAction(subjectId, action, detail, ip)` (wrapper específico
  para ações administrativas — usado de verdade só a partir da Fase 5,
  mas a função existe e é testada nesta fase).
- `web/lib/auth/cookies.js` — helpers para setar/ler/limpar
  `admin_session` e `client_session` (httpOnly, secure em produção,
  sameSite=lax, `maxAge` = TTL da sessão).
- `web/middleware.js` — middleware do Next.js: rotas sob
  `/admin/**` e `/api/admin/**` exigem `admin_session` válida (exceto
  `/admin/login` e `/api/admin/login`); rotas sob `/cliente/**` e
  `/api/client/**` exigem `client_session` válida (exceto
  `/cliente/entrar`, `/api/client/login`,
  `/api/client/magic-link/*`). Falha em rota de página → redirect;
  falha em rota de API → 401 JSON genérico.
- `web/app/admin/login/page.js` — form email+senha.
- `web/app/admin/page.js` — placeholder protegido ("Painel admin —
  em construção"), só para provar que o middleware funciona; Fase 5
  substitui o conteúdo.
- `web/app/api/admin/login/route.js` — `POST`.
- `web/app/api/admin/logout/route.js` — `POST`.
- `web/app/cliente/entrar/page.js` — form com duas opções: "receber
  link por e-mail" (chama `POST /api/client/magic-link/request`) ou,
  se o cliente já tiver senha definida, e-mail+senha
  (`POST /api/client/login`).
- `web/app/cliente/page.js` — placeholder protegido ("Área do
  cliente — em construção") + botão "criar senha de acesso"
  (`POST /api/client/set-password`); Fase 4 substitui o conteúdo.
- `web/app/api/client/login/route.js` — `POST`.
- `web/app/api/client/logout/route.js` — `POST`.
- `web/app/api/client/magic-link/request/route.js` — `POST`, recebe
  email, só cria+envia magic link se existir `orders` com aquele email
  e `status = 'paid'`; resposta sempre genérica
  ("se o e-mail tiver uma compra, enviamos um link"), independentemente
  do resultado real — não revela existência do email.
- `web/app/api/client/magic-link/consume/route.js` — `GET` (o link do
  e-mail aponta direto pra cá com `?token=...`), consome o token, cria
  sessão, redireciona para `/cliente`.
- `web/app/api/client/set-password/route.js` — `POST`, protegida pelo
  middleware (exige sessão de cliente ativa), grava/atualiza
  `client_credentials`.
- `scripts/create-admin.mjs` — script standalone (só precisa de
  `DATABASE_URL`), roda manualmente na VPS para inserir o admin_user
  inicial (pede email+senha via argumento, hasheia, insere).

### Fluxo — magic link na confirmação de compra

O ponto de disparo é o mesmo já existente no fluxo de webhook/outbox
(`web/lib/email.js` / `outbox_emails`), que hoje já monta o e-mail de
confirmação com o link de acesso ao produto. Esta fase estende esse
template para também incluir um `createMagicLink(buyer_email)` e
compor o link `/api/client/magic-link/consume?token=...` no corpo do
e-mail. Não há mudança na tabela `outbox_emails` nem no scheduler —
só no conteúdo do e-mail.

### Rate limiting

Reaproveita `web/lib/rate-limit.js` (chave composta, mesma tabela
`request_limits`):

- Login (admin e cliente): por IP+email, limite curto (ex.: 5
  tentativas / 15 min).
- Pedido de magic link (`/api/client/magic-link/request`): mais
  agressivo por ser vetor de spam de e-mail — por email, ex. 1 pedido
  a cada 2 min e no máximo 5/dia.

### Variáveis de ambiente

Nenhuma nova variável obrigatória de terceiros. Only internal
constants (TTLs) — ficam como constantes em código
(`web/lib/constants.js`), não em env var, já que não variam por
ambiente.

### Testes

`vitest`, mesmo padrão de `web/tests/`:

- `password.test.js` — hash determinístico por salt, verify correto
  para senha certa/errada.
- `session.test.js` — criação, leitura, expiração, destruição.
- `magicLink.test.js` — criação, consumo válido, token expirado, token
  já usado (não pode reusar), token inexistente.
- `rate-limit` (estende testes existentes se já cobrem o mecanismo
  genérico) — bloqueio após N tentativas de login e de pedido de magic
  link.
- Testes de rota (`route.test.js` por endpoint, mockando `db.js` como
  os testes existentes já fazem): login admin sucesso/falha/rate
  limit; consumo de magic link válido/expirado/usado; acesso a rota
  protegida sem cookie → 401/redirect.

### Segurança e tratamento de erro

- Mensagens de erro de login sempre genéricas ("e-mail ou senha
  inválidos"), nunca distinguem "email não existe" de "senha errada".
- Pedido de magic link sempre responde com a mesma mensagem genérica,
  exista ou não o email/pedido pago.
- `access_log.detail` nunca contém senha ou token em texto puro.
- Cookies: `httpOnly`, `secure` (produção), `sameSite=lax`. TTL sessão
  admin = 7 dias, sessão cliente = 30 dias.
- Rota protegida sem sessão válida: API responde 401 JSON genérico
  (sem detalhar motivo), página redireciona para o respectivo login.

### Critério de sucesso da fase

- Admin consegue logar em `/admin/login` com a conta criada via
  `scripts/create-admin.mjs` e ver o placeholder protegido em
  `/admin`.
- Um pedido pago (mesmo em modo TEST do Mercado Pago) gera e-mail de
  confirmação contendo o magic link; clicar nele loga o cliente e
  mostra o placeholder protegido em `/cliente`.
- Cliente consegue definir senha em `/cliente` e depois logar de novo
  via `/cliente/entrar` com e-mail+senha, sem precisar de novo e-mail.
- Acesso direto a `/admin` ou `/cliente` sem sessão redireciona para o
  login correspondente; acesso a `/api/admin/*` ou `/api/client/*` sem
  sessão retorna 401.
- Todos os testes novos passam (`npm test` em `web/`).

## Fora de escopo nesta fase

- Conteúdo real da área do cliente (lista de aulas, links externos) —
  Fase 4.
- Painel admin real (dashboard, CRUD de aulas, configurações em DB) —
  Fase 5.
- Cadastro de novos admins pela UI — deliberadamente fora de escopo
  para sempre, dado o caso de uso de admin único (pode ser revisitado
  se isso mudar).
- "Esqueci minha senha" para admin — como há um único admin com acesso
  à VPS, reset é manual via `scripts/create-admin.mjs` (upsert) se
  necessário; não vale a complexidade de um fluxo de e-mail para isso.
- Log de cada acesso individual a página/aula (só login/logout/ação
  admin) — pode ser revisitado na Fase 4 se houver necessidade real de
  métricas de visualização.
