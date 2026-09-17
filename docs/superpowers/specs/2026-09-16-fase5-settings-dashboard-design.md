# Fase 5 — Configurações gerais (criptografadas) + Dashboard

Status: aprovado, aguardando geração do plano de implementação.
Depende de: Fase 3 (autenticação) e Fase 4 (CRUD de aulas) — concluídas,
revisadas e verificadas em produção. Reaproveita `resolveSession`,
`logAdminAction`, `/admin` (vira o dashboard) e o padrão de rotas/testes
já estabelecido.
Escopo: o restante da Fase 5 do backlog ("dashboard, configurações em
DB"), com a decisão já tomada nesta sessão de incluir credenciais
criptografadas (Mercado Pago, SMTP) no mesmo pacote.

## Contexto do projeto (para sessões futuras sem histórico da conversa)

- Hoje TODA configuração do app vem de variáveis de ambiente no `.env`
  da VPS (`web/lib/env.js`): `APP_BASE_URL`, `MERCADOPAGO_*`, `SMTP_*`,
  `PRODUCT_ACCESS_URL`, `CRON_SECRET`, `DATABASE_URL`, mais o produto
  fixo em `web/lib/constants.js` (`PRODUCT`). Isso ainda está parcialmente
  pendente (Fase 2): Mercado Pago e SMTP reais nunca foram cadastrados.
- **Decisão desta sessão — o que migra para o banco (editável no painel,
  com fallback para `.env` durante a transição) e o que fica só em
  `.env`:**
  - **Migra:** produto (título, descrição, preço, moeda — texto puro),
    Mercado Pago (chave pública — texto puro; access token e webhook
    secret — **criptografados**), SMTP (host/porta/seguro/usuário — texto
    puro; senha — **criptografada**), remetente/reply-to de e-mail (texto
    puro), `PRODUCT_ACCESS_URL` (**criptografado** — é o link que dá
    acesso ao produto de graça se vazar, tratado como segredo mesmo não
    sendo uma "credencial" no sentido técnico).
  - **Fica só em `.env`:** `DATABASE_URL` (dependência circular — o app
    precisa dela pra sequer conectar no banco onde as outras
    configurações ficariam), `APP_BASE_URL` e `CRON_SECRET` (infra de
    bootstrapping, já mexida a fundo na Fase 3 — manter fora reduz risco
    sem perder o benefício real pedido pelo usuário, que era sobre dados
    de produto/serviço e credenciais de terceiros), e a nova
    `SETTINGS_ENCRYPTION_KEY` (a chave que criptografa as outras — mesmo
    raciocínio da `DATABASE_URL`, não pode estar no banco que ela mesma
    protege).
- **Efeito colateral direto e desejado:** isso resolve a pendência antiga
  da Fase 2 de um jeito mais amigável — em vez de o usuário editar
  `.env` via SSH, ele cadastra Mercado Pago/SMTP pela tela
  `/admin/config`.
- **Preço do checkout já é snapshotado por pedido**: a tabela `orders`
  (Fase 2) já grava `product_title`, `amount_cents`, `currency` no
  momento da criação do pedido — `web/lib/http.js`'s `publicOrder` já lê
  esses campos do pedido, não de `PRODUCT`. Isso significa que **só dois
  lugares** precisam ler a configuração "ao vivo" (o preço atual, antes
  de existir pedido): `web/app/api/config/route.js` (mostra preço na
  landing) e `createOrder` (grava o snapshot no pedido novo). Todo o
  resto do fluxo de pagamento (`mercadopago.js`, a validação de
  reconciliação em `orders.js`) passa a ler do **próprio pedido**
  (`order.amount_cents`, `order.product_code`, etc.), não de uma
  configuração global — o que é, na verdade, mais correto
  financeiramente (um pagamento deve bater com o que estava no pedido
  quando ele foi criado, não com o preço atual se o admin mudou depois).

## Design

### Schema (`migrations/004_settings.sql`)

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

A migration semeia só os 4 campos de produto (valores idênticos aos
hoje fixos em `constants.js` — o checkout não muda no dia 1). Mercado
Pago, SMTP, e-mail e `product_access_url` começam sem linha no banco —
`web/lib/settings.js` cai para a env var equivalente até o admin
preencher pela tela.

Valor com `encrypted = true` é armazenado como `iv:authTag:ciphertext`
(hex, AES-256-GCM, `node:crypto` — sem dependência nova).

### Nova variável de ambiente

`SETTINGS_ENCRYPTION_KEY` — 32 bytes em base64. Só em `.env`, nunca no
banco. Gerada uma vez (`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`)
e cadastrada na VPS antes do primeiro uso de qualquer campo
criptografado.

### Estrutura de arquivos (novo em `web/`)

- `web/lib/settingsCrypto.js` — `encryptValue(plaintext)`,
  `decryptValue(stored)`. Usa `SETTINGS_ENCRYPTION_KEY` via
  `web/lib/env.js` (novo getter `settingsEncryptionKey()`).
- `web/lib/settings.js` — camada única de acesso a `settings`:
  - `getSetting(key)` / `setSetting(key, value)` — CRUD genérico,
    decide criptografar com base num mapa interno `SETTING_DEFS`.
  - `getAllSettingsForAdmin()` — shape pronto para a tela: campos texto
    puro com o valor real, campos criptografados como
    `{ configured: boolean }` (nunca devolve o segredo pro navegador).
  - `getProductSettings()` → `{ title, description, amountCents,
    currency }`, banco com fallback pros valores hoje fixos em
    `constants.js` (caso a seed nunca tenha rodado).
  - `getMercadoPagoSettings()` → `{ publicKey, accessToken,
    webhookSecret }`, banco com fallback pra
    `MERCADOPAGO_PUBLIC_KEY`/`MERCADOPAGO_ACCESS_TOKEN`/`MERCADOPAGO_WEBHOOK_SECRET`.
  - `getSmtpSettings()` → `{ host, port, secure, user, password, from,
    replyTo }`, banco com fallback pros `SMTP_*`/`EMAIL_*` de hoje.
  - `getProductAccessUrl()` → string, banco com fallback pra
    `PRODUCT_ACCESS_URL`.
- `web/lib/schemas.js` — `settingsUpdateSchema` (Zod, todos os campos
  opcionais — o PATCH aceita atualização parcial; campo criptografado
  omitido ou vazio = não muda o valor já salvo).
- `web/lib/dashboard.js` — `getDashboardStats()`: total de pedidos
  pagos, receita total (soma de `amount_cents` dos pagos), contagem por
  `status`, os 20 pedidos mais recentes.
- `web/app/api/admin/settings/route.js` — `GET` (retorna
  `getAllSettingsForAdmin()`), `PATCH` (valida com
  `settingsUpdateSchema`, grava via `setSetting` por campo alterado,
  loga `logAdminAction(..., 'update_settings', ...)`).
- `web/app/admin/config/page.js` + `ConfigManager.js` — mesmo padrão
  guard+client-component de `/admin/aulas`. Seções: Produto, Mercado
  Pago, E-mail (SMTP), Acesso ao produto. Campos criptografados
  aparecem como "configurado ✓ / não configurado" com um input vazio
  para digitar um valor novo (deixar em branco = mantém o atual).
- `web/app/admin/page.js` — passa a mostrar `getDashboardStats()`
  (receita, contagem por status, tabela de pedidos recentes) além dos
  links já existentes para `/admin/aulas` e (novo) `/admin/config`.

### Refatoração dos consumidores existentes (Fase 2, sem mudar comportamento)

- `web/lib/orders.js`:
  - `createOrder` passa a chamar `getProductSettings()` para montar o
    `insert` (em vez de `PRODUCT.code/title/amountCents/currency`) —
    `product_code` continua uma constante fixa (`PRODUCT_CODE` em
    `constants.js`, não é editável, é um identificador interno).
    Também grava o novo `product_description`.
  - `applyOfficialPayment`'s validação de divergência passa a comparar
    com `order.product_code`/`order.currency` (o que já está gravado no
    próprio pedido), não mais com `PRODUCT.code`/`PRODUCT.currency`
    globais — mais correto (compara com o preço do momento da compra,
    não com a configuração atual).
- `web/lib/mercadopago.js`: `createPayment` passa a montar
  `transaction_amount`/`description`/`metadata.product_code` a partir de
  `order.amount_cents`/`order.product_description ||
  order.product_title`/`order.product_code` (todos já disponíveis no
  `order` que a função já recebe) em vez de importar `PRODUCT`.
  `mercadoPagoRequest` passa a buscar o access token via
  `getMercadoPagoSettings()` em vez de `serverConfig().mercadoPagoAccessToken`.
- `web/lib/email.js`: `sendMagicLinkEmail` e `processEmailOutbox` passam
  a usar `getSmtpSettings()` em vez de `smtpConfig()`. `buildEmail` usa
  `order.product_title` (a query em `processEmailOutbox` ganha
  `o.product_title` no `select`) em vez do `PRODUCT.title` global, e
  `getProductAccessUrl()` em vez de `serverConfig().productAccessUrl`
  (só onde já é assíncrono — ambos já são).
- `web/lib/http.js`: `publicOrder` vira `async` (só por causa do
  `accessUrl`, que passa a vir de `getProductAccessUrl()` em vez de
  `process.env.PRODUCT_ACCESS_URL` direto); os dois pontos de chamada em
  `web/app/api/orders/route.js` (GET e POST) ganham `await`.
- `web/app/api/config/route.js`: troca `publicConfig()` +
  `PRODUCT.title/amountCents/currency` por
  `getMercadoPagoSettings().publicKey` + `getProductSettings()`.
- `web/lib/constants.js`: `PRODUCT` é removido (nada mais o importa
  depois da refatoração acima); vira só `PRODUCT_CODE = 'xadrez-essencial-pdf'`.
  `TERMINAL_PAYMENT_STATUSES`/`CONFIRMED_PAYMENT_STATUS`/`SESSION_TTL_SECONDS`/`MAGIC_LINK_TTL_SECONDS`
  continuam inalterados.
- `web/tests/security.test.mjs`: o teste que hoje verifica
  `PRODUCT.amountCents === 3990` passa a verificar o valor semeado pela
  migration (mesma garantia — preço não vem do cliente — mas a fonte
  runtime agora é `getProductSettings()`, mockando `db.js` como os
  outros testes já fazem).

### Testes

- `web/tests/settingsCrypto.test.mjs` — round-trip encrypt/decrypt,
  falha com chave/formato inválido.
- `web/tests/settings.test.mjs` — `getSetting`/`setSetting` (mock `pg`,
  mesmo padrão de `session.test.mjs`), e cada `get*Settings()` testado
  com e sem linha no banco (confirma o fallback pra env var).
- `web/tests/settings-schema.test.mjs` — `settingsUpdateSchema` aceita
  atualização parcial, rejeita tipos errados.
- `web/tests/dashboard.test.mjs` — `getDashboardStats()` com mock `pg`.
- `web/tests/security.test.mjs` — assinatura atualizada (ver acima).
- Rotas/páginas de admin settings seguem a convenção já estabelecida
  (sem teste de `route.js`/página, coberto pela rede de
  `acceptance-coverage.test.mjs`, que ganha as leituras/asserções para
  `web/app/api/admin/settings/route.js`).

### Segurança

- `GET /api/admin/settings` nunca devolve o valor de um campo
  criptografado — só `{ configured: true|false }`.
- `PATCH` só sobrescreve um campo criptografado se o valor vier
  não-vazio; omitido ou string vazia = mantém o que já está salvo.
- `SETTINGS_ENCRYPTION_KEY` ausente ou com tamanho errado falha alto e
  cedo (erro claro), nunca silenciosamente grava/lê texto puro no lugar
  de criptografado.

### Critério de sucesso da fase

- Admin consegue, em `/admin/config`: editar título/descrição/preço do
  produto e ver o novo preço refletido em `/api/config` e em um pedido
  novo criado depois da mudança (pedidos antigos mantêm o preço
  gravado na hora da compra).
- Admin consegue cadastrar Mercado Pago (chave pública, access token,
  webhook secret) e SMTP pela tela, sem precisar de SSH.
- Um valor criptografado nunca aparece em texto puro em nenhuma
  resposta de API nem é logado em `access_log.detail`.
- `/admin` mostra receita total, contagem de pedidos por status e uma
  tabela dos pedidos recentes, batendo com o banco.
- Todos os testes novos passam (`cd web && npx vitest run`).
- Checkout, webhook e e-mail de confirmação continuam funcionando
  exatamente como antes desta fase enquanto Mercado Pago/SMTP não forem
  preenchidos pela tela (fallback pro `.env`, sem regressão).

## Fora de escopo nesta fase

- Mover `DATABASE_URL`, `APP_BASE_URL`, `CRON_SECRET` pro banco —
  ficam em `.env` pelas razões já explicadas.
- Qualquer métrica de dashboard além de vendas/pedidos (ex.: contagem
  de aulas, clientes com senha cadastrada) — pode virar um incremento
  futuro pequeno, não motivo pra reabrir esta fase agora.
- Rotação da `SETTINGS_ENCRYPTION_KEY` ou re-criptografia em massa —
  não existe hoje nenhum valor criptografado pra migrar; o dia em que a
  chave precisar rotacionar é um problema separado, resolvido quando
  surgir.
