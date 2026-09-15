# Fase 2 — Migrar app atual (landing + checkout + webhook + cron) para Next.js

Status: aprovado, aguardando geração do plano de implementação.
Depende de: Fase 1 (infra VPS), já concluída — `web/` já existe com
Next.js App Router, Docker, Traefik e Postgres rodando em produção em
`https://chess.dlsistemas.com.br`.
Bloqueia: Fase 3 (autenticação), que assume o app real (não o esqueleto)
já rodando na VPS.

## Contexto do projeto (para sessões futuras sem histórico da conversa)

Este spec cobre só a Fase 2 do backlog em `BACKLOG.md` (raiz do repo).
Decisões de arquitetura já fechadas para o projeto inteiro, necessárias
para entender o porquê das escolhas abaixo:

- Migração completa da Vercel para a VPS própria.
- Next.js (App Router) único cobrindo landing page, checkout, webhook,
  reconciliação, painel admin e área do cliente — tudo no mesmo
  app/processo (`web/`).
- Nunca editar o crontab root compartilhado da VPS — jobs agendados
  deste projeto rodam dentro do próprio processo da aplicação.
- Nunca persistir dado de cartão de crédito (Mercado Pago já tokeniza).

Fatos confirmados com o usuário nesta sessão de brainstorming
(2026-09-15), específicos desta fase:

- **Sem dados reais para migrar**: o banco atual (usado pela Vercel) está
  vazio ou só com testes — não há pedidos/clientes reais. A Fase 2 aplica
  o schema do zero no Postgres da VPS, sem migração de dados.
- **Domínio final já é `chess.dlsistemas.com.br`** — é o mesmo domínio que
  a Vercel já usava em produção. O DNS (via Cloudflare) já aponta para a
  VPS desde a Fase 1. **Confirmado nesta sessão: a landing/checkout real
  está fora do ar nesse domínio agora**, substituída pelo esqueleto da
  Fase 1 — usuário ciente, sem problema porque não há tráfego real
  dependendo disso. Não há corte de DNS a fazer nesta fase; é só trocar o
  que responde no domínio que já está apontado corretamente.
- **Frontend mantido como está**: `index.html`, `assets/checkout.js`,
  `success.html` continuam pixel-a-pixel idênticos, só realocados para
  serem servidos pelo Next.js. Nenhuma reescrita em React nesta fase.
- **Lógica de negócio portada quase literal**: toda a lógica hoje em
  `api/_lib/*` (pedidos, Mercado Pago, e-mail, webhook, rate limit) é
  reaproveitada praticamente sem mudança — só a camada de adaptação
  Vercel `(req, res)` vira Route Handlers do App Router
  (`Request`/`Response` do Fetch API). Sem shim de compatibilidade.

## O que existe hoje (api/ na raiz, hospedado na Vercel)

Levantado por leitura direta do código nesta sessão:

- `api/config.js` — `GET`, config pública (chave pública do Mercado Pago,
  preço do produto).
- `api/orders.js` — `GET` (busca pedido por token) e `POST` (cria pedido).
- `api/payments/pix.js` — `POST`, cria pagamento Pix.
- `api/payments/card.js` — `POST`, cria pagamento com cartão tokenizado.
- `api/mercadopago/webhook.js` — `POST`, recebe notificação do Mercado
  Pago, valida assinatura HMAC, aplica pagamento oficial, dispara e-mail.
- `api/cron/reconcile.js` — `GET`/`POST` protegido por `Bearer
  ${CRON_SECRET}`, reconcilia pagamentos pendentes e processa outbox de
  e-mail. Hoje agendado via Vercel Cron (`vercel.json`, a cada 10 min).
- `api/_lib/`: `constants.js` (produto/preço), `db.js` (pool Postgres,
  `query`/`withTransaction`), `email.js` (SMTP + outbox), `env.js`
  (helpers de env var obrigatória/opcional), `http.js` (adaptadores
  `(req,res)` estilo Vercel — `sendJson`, `readJson`, `method`,
  `getClientIp`, `publicOrder`), `mercadopago.js` (client da API do
  Mercado Pago), `orders.js` (regras de pedido/pagamento), `rate-limit.js`,
  `schemas.js` (validação Zod), `webhook.js` (verificação de assinatura
  HMAC).
- `index.html` + `assets/checkout.js` — landing/checkout, chama
  `/api/config`, `/api/orders`, `/api/payments/pix`,
  `/api/payments/card`.
- `success.html` + `assets/success.js` — página pós-checkout, chama
  `/api/orders?token=...`; alcançada via
  `window.location.assign('success.html?token=...')` (caminho relativo).
- `migrations/001_init.sql` + `scripts/migrate.js` — schema Postgres,
  script standalone que só precisa de `DATABASE_URL` no ambiente.
- `tests/*.test.mjs` (13 testes) — testam `api/_lib/*` diretamente
  (webhook, email, security, frontend, acceptance-coverage).

## O que já existe no `web/` (Fase 1, não mexer na estrutura, só estender)

- `web/lib/db.js` — só `checkDatabaseConnection`/`resetPoolForTests`
  hoje; precisa ganhar `query`/`withTransaction`/`getPool` (vindos de
  `api/_lib/db.js`, mesma implementação).
- `web/app/page.js`, `web/app/layout.js` — página esqueleto que esta fase
  substitui pelo conteúdo real.
- `web/app/api/health/route.js` — mantém, é útil independente da
  migração.
- `web/next.config.mjs` — `output: 'standalone'`,
  `outputFileTracingRoot` fixado; ganha um `rewrites()` nesta fase.
- `web/Dockerfile`, `deploy/docker-compose.yml` — infra já pronta, sem
  mudança estrutural (só as variáveis de ambiente reais crescem).

## Design

### Estrutura de arquivos (novo em `web/`)

```
web/
  app/
    page.js                          # REMOVIDO (era o esqueleto da Fase 1)
    layout.js                        # mantém
    api/
      health/route.js                # mantém (Fase 1)
      config/route.js                # api/config.js
      orders/route.js                # api/orders.js
      payments/
        pix/route.js                 # api/payments/pix.js
        card/route.js                # api/payments/card.js
      mercadopago/
        webhook/route.js             # api/mercadopago/webhook.js
      cron/
        reconcile/route.js           # api/cron/reconcile.js (trigger manual, mesma auth)
  lib/
    db.js                            # estende o da Fase 1 com query/withTransaction/getPool
    constants.js                     # api/_lib/constants.js
    email.js                         # api/_lib/email.js
    env.js                           # api/_lib/env.js
    http.js                          # só o que sobra de api/_lib/http.js: getClientIp, publicOrder
    mercadopago.js                   # api/_lib/mercadopago.js
    orders.js                        # api/_lib/orders.js
    rate-limit.js                    # api/_lib/rate-limit.js
    schemas.js                       # api/_lib/schemas.js
    webhook.js                       # api/_lib/webhook.js
    reconcile.js                     # NOVO: extrai o corpo de api/cron/reconcile.js
                                      #   para uma função runReconciliation(),
                                      #   chamada pelo agendador E pela rota manual
  instrumentation.js                 # NOVO: register() agenda runReconciliation()
                                      #   a cada 10 min via node-cron
  public/
    index.html                       # realocado de raiz, sem mudança de conteúdo
    success.html                     # idem
    assets/
      checkout.js                    # idem
      success.js                     # idem
      capa-xadrez-essencial.png      # idem
      exercicio-tabuleiro.png        # idem
      gabarito-visual.png            # idem
  tests/
    db.test.mjs                      # mantém (Fase 1)
    webhook.test.mjs                 # de tests/webhook.test.mjs, import ajustado
    email.test.mjs                   # idem
    security.test.mjs                # idem
    frontend.test.mjs                # idem
    acceptance-coverage.test.mjs     # idem
  package.json                       # ganha mercadopago, nodemailer, zod, node-cron
```

Migrations: **não duplica** `migrations/001_init.sql` nem
`scripts/migrate.js` dentro de `web/`. Continuam na raiz do repo,
reaproveitados como estão — rodam uma vez contra o `DATABASE_URL` do
Postgres da VPS durante o deploy desta fase (`node scripts/migrate.js`
com `DATABASE_URL` apontando pro Postgres do Fase 1, de fora do container
ou via `docker exec`/túnel, a definir no plano de implementação).

### Adaptação Vercel `(req,res)` → App Router `Request`/`Response`

Cada rota HTTP vira um arquivo `route.js` exportando as funções `GET`/
`POST` que o método precisa. Mapeamento direto de responsabilidades do
`api/_lib/http.js` atual:

- `sendJson(res, status, payload)` → `NextResponse.json(payload, {
  status })`, chamado no final de cada handler — não precisa de helper
  próprio, é a API nativa do Next.
- `readJson(req)` → `await request.json()` — Next já dá o body parseado
  (com `try/catch` para JSON inválido, tratado como `ZodError`-like erro
  400).
- `method(req, res, allowed)` → não precisa de helper: um `route.js` só
  exporta os métodos que aceita; o Next responde `405` automaticamente
  para os que não existem.
- `getClientIp(req)` → adaptado para ler de `request.headers.get(...)`
  em vez de `req.headers[...]`.
- `publicOrder(order, attempt)` → migra sem mudança (função pura, não
  depende de req/res).

O corpo de cada handler (validação Zod, chamadas a `_lib/orders.js`,
`_lib/mercadopago.js`, etc.) migra **sem mudança de lógica** — só a
casca de entrada/saída muda.

### Reconciliação (cron)

`web/lib/reconcile.js` exporta `runReconciliation()` com o corpo exato de
`api/cron/reconcile.js` (a query de pedidos pendentes, reconciliação via
Mercado Pago, processamento do outbox de e-mail), sem o envelope
HTTP/auth.

Dois pontos de entrada chamam essa mesma função:

1. `web/instrumentation.js` — `register()` roda uma vez quando o
   processo do Next sobe (compatível com `output: 'standalone'`, ao
   contrário de um custom server) e agenda `runReconciliation()` a cada
   10 minutos via `node-cron`, com lock simples em memória para não
   rodar duas execuções sobrepostas se uma demorar mais que o intervalo.
2. `web/app/api/cron/reconcile/route.js` — mantém o endpoint HTTP atual
   (`GET`/`POST`, auth `Bearer ${CRON_SECRET}`) só para trigger manual/
   observabilidade — chama `runReconciliation()` e devolve o resultado,
   sem reimplementar a lógica.

### Frontend estático

`web/public/index.html`, `success.html` e `assets/*` são cópias
byte-a-byte dos arquivos atuais da raiz. O Next serve arquivos de
`public/` no path exato (`/success.html`, `/assets/checkout.js` — os
caminhos relativos já usados no HTML/JS atual continuam funcionando sem
mudança, porque são resolvidos relativos à URL visível no navegador).

A única adição necessária é em `web/next.config.mjs`, um `rewrites()`
mapeando a raiz para o arquivo estático (já que `app/page.js` do
esqueleto da Fase 1 é removido e não há mais nada dinâmico respondendo
em `/`):

```js
async rewrites() {
  return [{ source: '/', destination: '/index.html' }];
}
```

### Variáveis de ambiente

`/opt/xadrez-essencial/.env` na VPS (já existe da Fase 1 com
`POSTGRES_*`/`DATABASE_URL`/`DATABASE_SSL`/`PORT`) ganha as variáveis que
faltam, mesma lista do `.env.example` atual da raiz:
`MERCADOPAGO_PUBLIC_KEY`, `MERCADOPAGO_ACCESS_TOKEN`,
`MERCADOPAGO_WEBHOOK_SECRET`, `MERCADOPAGO_EXPECTED_COLLECTOR_ID`,
`APP_BASE_URL` (= `https://chess.dlsistemas.com.br`), `PRODUCT_ACCESS_URL`,
`CRON_SECRET`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`,
`SMTP_PASSWORD`, `EMAIL_FROM`, `EMAIL_REPLY_TO`. Valores reais (produção)
fornecidos pelo usuário no momento da implementação, nunca commitados —
mesma disciplina da Fase 1.

Webhook do Mercado Pago precisa ser recadastrado (ou confirmado) apontando
para `https://chess.dlsistemas.com.br/api/mercadopago/webhook` — ação do
usuário no painel do Mercado Pago, fora do alcance da automação, listada
como passo manual no plano de implementação.

### Testes

`tests/*.test.mjs` (13 testes atuais) migram para `web/tests/`. A maioria
só precisa de ajuste de import (`../api/_lib/...` → `../lib/...`), mas
dois arquivos leem arquivo-fonte bruto via `process.cwd()` e precisam de
ajuste de caminho, não só de import:

- `frontend.test.mjs` lê `index.html` e `assets/checkout.js` direto da
  raiz do `cwd` — passam a apontar para `public/index.html` e
  `public/assets/checkout.js` (caminhos relativos a `web/`, onde os
  testes rodam).
- `acceptance-coverage.test.mjs` lê `migrations/001_init.sql`,
  `assets/checkout.js`, `api/_lib/orders.js`, `api/mercadopago/webhook.js`
  e `api/cron/reconcile.js` como texto bruto. Como `migrations/` **não**
  migra para `web/` (continua na raiz do repo), essa referência vira
  `path.join(process.cwd(), '..', 'migrations', '001_init.sql')`; as
  demais apontam para os novos caminhos dentro de `web/`
  (`public/assets/checkout.js`, `lib/orders.js`,
  `app/api/mercadopago/webhook/route.js`, `app/api/cron/reconcile/route.js`).

Sem teste novo de comportamento — a suíte existente já cobre o que está
sendo portado, só aponta pros novos endereços dos arquivos.
`web/tests/db.test.mjs` (Fase 1) continua como está.

### Limpeza (só depois de validado em produção)

Depois que a Fase 2 estiver rodando de verdade na VPS (checkout real
testado ponta a ponta, webhook confirmado, cron reconciliando), um commit
de limpeza remove da raiz do repo: `api/`, `index.html`, `assets/`,
`success.html`, `vercel.json`. `migrations/` e `scripts/migrate.js`
continuam (ainda usados para aplicar schema/futuras migrações). O
projeto na Vercel em si (pausar ou apagar) só é tocado com confirmação
explícita do usuário antes, por ser ação num serviço de terceiro.

### Critério de sucesso da fase

- `https://chess.dlsistemas.com.br` serve o `index.html` real (não mais o
  esqueleto), com checkout funcional ponta a ponta: criar pedido, pagar
  via Pix (QR gerado) e via cartão (tokenizado), ver status em
  `success.html`.
- Webhook do Mercado Pago recebido e processado (assinatura validada,
  pagamento aplicado, e-mail disparado).
- Reconciliação rodando automaticamente a cada 10 min dentro do processo
  do app, sem depender de cron externo nem do crontab root da VPS.
- Suíte de testes portada (`web/tests/`) passando, mesma cobertura de
  antes.
- Nenhum container/rede/porta de outro projeto na VPS alterado (mesma
  verificação de isolamento da Fase 1).

## Fora de escopo nesta fase

- Autenticação, painel admin, área do cliente (Fases 3–5).
- Reescrita do frontend em React (mantido como HTML/JS estático).
- Migração de dados reais (base está vazia).
- Corte de DNS (já aponta para a VPS desde a Fase 1).
- Pausar/apagar o projeto na Vercel (decisão e ação separada, após
  validação, com confirmação explícita do usuário).
