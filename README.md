# landing_chess

Landing page do produto digital **Xadrez Essencial** com checkout transparente Mercado Pago, Pix, cartao, conciliacao via webhook/cron e entrega por e-mail transacional.

## Arquitetura

- Frontend estatico em `index.html` e `assets/checkout.js`.
- Backend serverless Vercel em `api/`.
- Checkout Transparente via Mercado Pago Payments API (`/v1/payments`) com `MercadoPago.js`/CardForm para tokenizacao do cartao e Pix com QR Code.
- Banco PostgreSQL via `DATABASE_URL`; pedidos, tentativas, webhooks, outbox de e-mail e rate limits sao persistidos.
- Envio de e-mail por SMTP TLS com outbox duravel e retries.
- Conciliacao por webhook e por rotina protegida em `/api/cron/reconcile`.

## Variaveis de ambiente

Cadastre na Vercel em Development, Preview e Production, usando credenciais de teste nos ambientes nao produtivos:

- `MERCADOPAGO_PUBLIC_KEY`
- `MERCADOPAGO_ACCESS_TOKEN`
- `MERCADOPAGO_WEBHOOK_SECRET`
- `MERCADOPAGO_EXPECTED_COLLECTOR_ID` opcional, recomendado
- `APP_BASE_URL`
- `DATABASE_URL`
- `DATABASE_SSL`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_SECURE`
- `SMTP_USER`
- `SMTP_PASSWORD`
- `EMAIL_FROM`
- `EMAIL_REPLY_TO` opcional
- `PRODUCT_ACCESS_URL`
- `CRON_SECRET`

Somente `MERCADOPAGO_PUBLIC_KEY` vai para o navegador. `PRODUCT_ACCESS_URL` fica apenas no servidor e so entra no e-mail apos pagamento confirmado.

## Banco de dados

Execute as migrations apos configurar `DATABASE_URL`:

```bash
npm run migrate
```

As migrations criam `orders`, `payment_attempts`, `webhook_events`, `outbox_emails`, `provider_events`, `request_limits` e `schema_migrations`.

## Webhook Mercado Pago

URL HTTPS para cadastrar no painel do Mercado Pago:

```text
{APP_BASE_URL}/api/mercadopago/webhook
```

Habilite o evento **Pagamentos**. O endpoint valida `x-signature` usando `x-request-id`, `data.id` e `MERCADOPAGO_WEBHOOK_SECRET`, registra o evento, consulta `/v1/payments/{id}` no servidor e so confirma a compra apos validar pedido, valor, moeda, produto e recebedor esperado quando configurado.

## Conciliacao e e-mails

O `vercel.json` agenda:

```text
*/10 * * * * -> /api/cron/reconcile
```

Na Vercel, mantenha `CRON_SECRET` configurado. A rotina compara pedidos/tentativas pendentes com o estado oficial do Mercado Pago, registra reembolsos/contestas posteriores e processa a outbox de e-mails pendentes ou falhos.

SMTP nao garante envio unico absoluto quando ha falha ambigua depois do aceite do servidor. A implementacao reduz duplicidade com unicidade por pedido, status transacional e retry com backoff.

## Testes e validacao real

Testes automatizados locais usam simulacao e nao criam cobrancas reais:

```bash
npm test
npm run lint
npm run build
```

Para validar com provedor:

1. Use credenciais oficiais de teste do Mercado Pago.
2. Configure webhook no painel do Mercado Pago e simule uma notificacao.
3. Rode uma compra de teste com cartoes de teste e Pix em ambiente autorizado.
4. Nao use credenciais de producao para testes automatizados.

## Deploy

1. Configure todas as variaveis na Vercel.
2. Rode as migrations no PostgreSQL de destino.
3. Faca redeploy para que as variaveis sejam carregadas.
4. Cadastre o webhook HTTPS no Mercado Pago.
5. Confirme que a Vercel Cron esta ativa no projeto.
