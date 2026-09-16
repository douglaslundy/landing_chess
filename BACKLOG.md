# Backlog — Migração para VPS + Plataforma de Aulas

> Arquivo de estado persistente. Objetivo: qualquer sessão futura (humana ou do
> Claude) consegue retomar o trabalho lendo só este arquivo, sem precisar
> reconstruir o histórico da conversa. Atualize o status a cada fase concluída
> e linke o spec/plano correspondente assim que existir.

## Decisões de arquitetura já tomadas

- Migração **completa** da Vercel para uma VPS própria (nada fica dependendo
  da Vercel ao final).
- Isolamento via **Docker** (app + Postgres em containers dedicados, rede
  própria) — não deve tocar em nenhum processo/container de outros projetos
  já hospedados na mesma VPS.
- Aplicação única em **Next.js (App Router)**: landing page, checkout
  (Pix/cartão via Mercado Pago), webhook, reconciliação, painel admin e área
  do cliente — tudo no mesmo app/processo.
- Conteúdo das aulas = **apenas links externos** cadastrados pelo admin (PDF
  em repositório externo, vídeo do YouTube). Não há upload/armazenamento de
  arquivo no projeto.
- Nunca persistir dado de cartão de crédito (Mercado Pago já tokeniza; regra
  vale para todo o sistema novo também).
- Chave SSH da VPS: `~/.ssh/id_ed25519` (`C:\Users\dougl\.ssh\id_ed25519`),
  confirmado em 2026-09-15 — arquivo existe localmente e `known_hosts` tem
  3 entradas prévias para `144.91.92.70`, indicando uso anterior real. (A
  claim antiga apontando para a pasta irmã `sysread` estava errada — aquele
  é um projeto não relacionado, "Sysread" PWA de leitura, sem chave
  nenhuma; corrigido.) Nunca commitar a chave.

## Infra da VPS (fatos fixos, não re-perguntar)

- VPS: `144.91.92.70`, usuário `root`, chave `~/.ssh/id_ed25519`.
- Domínio do projeto: `chess.dlsistemas.com.br` (DNS A → 144.91.92.70,
  criação do registro é responsabilidade do usuário).
- Reverse proxy já existente: Traefik (labels Docker, rede externa
  `proxy`, certresolver `letsencrypt`). Não há Nginx manual.
- Convenção de outros sistemas na VPS: `/opt/<nome>/`, rede interna
  própria para o banco, container público também na rede `proxy`. Doc
  oficial em `/opt/INFRA-README.md` na própria VPS.
- Nunca editar o crontab root (compartilhado com outros projetos).
- `Xadrez_Platform_Codex_Blueprint` (pasta irmã) foi descartado pelo
  usuário — não usar como base, é uma tentativa antiga abandonada.
- Detalhes completos do levantamento: veja
  `docs/superpowers/specs/2026-09-14-fase1-infra-vps-design.md`.

## Fases

| Fase | Descrição | Status |
|---|---|---|
| 0 | Higiene: repo atualizado + backlog persistente | ✅ Concluída (2026-09-14) |
| 1 | Infra na VPS (recon read-only, Docker, Traefik, Postgres, rollback) | ✅ Concluída (2026-09-15) — [design](docs/superpowers/specs/2026-09-14-fase1-infra-vps-design.md), [plano](docs/superpowers/plans/2026-09-15-fase1-infra-vps.md). `https://chess.dlsistemas.com.br` no ar, TLS válido, app↔postgres ok, isolamento validado. Revisão final (5 fixes: renderização dinâmica da home, TLS verificado por padrão, health endpoint sem vazar erro, middleware Traefik próprio em vez de emprestado do `corridas`, nome de projeto Compose fixado como `xadrez`) já aplicada e reimplantada. |
| 2 | Migrar app atual (landing + checkout + webhook + cron) para Next.js | 🟡 Deploy feito + revisão final aplicada, checkout pendente (2026-09-15) — [design](docs/superpowers/specs/2026-09-15-fase2-app-migration-design.md), [plano](docs/superpowers/plans/2026-09-15-fase2-app-migration.md). `chess.dlsistemas.com.br` serve a landing real. Tasks 1-8 completas e revisadas; revisão final da branch inteira achou e corrigiu 1 Critical (IP real via `CF-Connecting-IP`, já que o Traefik da VPS não tem `trustedIPs` configurado e sobrescreve o `X-Forwarded-For` com o IP do Cloudflare) + 3 Important (JSON vazio causando 500, trap de geração estática em `/api/config`/`/api/health`, webhook falhando aberto sem `MERCADOPAGO_WEBHOOK_SECRET`) + 4 Minor — tudo corrigido e reimplantado. Faltando: usuário cadastrar credenciais reais (Mercado Pago TEST, SMTP, `PRODUCT_ACCESS_URL`, `CRON_SECRET`) no `/opt/xadrez-essencial/.env` da VPS — sem isso `/api/config`, pagamentos, webhook e cron continuam retornando erro controlado. Task 9 (verificação end-to-end real) e Task 10 (limpeza dos arquivos Vercel) ficam pendentes até as credenciais serem cadastradas — retomar apendando as variáveis no `.env`, rebuild+restart do `app`, depois rodar a verificação completa. |
| 3 | Autenticação (admin + cliente) + log de acesso | ✅ Concluída e verificada em produção (2026-09-16) — [design](docs/superpowers/specs/2026-09-16-fase3-auth-design.md), [plano](docs/superpowers/plans/2026-09-16-fase3-auth.md). Schema (`admin_users`, `client_credentials`, `sessions`, `magic_links`, `access_log`) aplicado na VPS. Admin: login/logout com sessão de 7 dias, conta única criada via `scripts/create-admin.mjs` (gera SQL localmente, nunca expõe a senha em texto puro para a VPS). Cliente: acesso via magic link (e-mail de confirmação de compra) com senha opcional, sessão de 30 dias. Log de acesso cobre login/logout de ambos os perfis. Proteção de rota via guard explícito (`resolveSession`) em vez de `web/middleware.js` — decisão documentada no plano (Edge Runtime do Next.js não suporta `pg`). Verificação end-to-end em `chess.dlsistemas.com.br` confirmou: login/logout admin, magic link → sessão → set-password → login por senha, todos os 4 casos de acesso protegido (com/sem sessão válida, admin e cliente). 3 bugs reais encontrados e corrigidos durante a verificação: (1) guard do CLI `scripts/create-admin.mjs` nunca disparava no Windows (path com backslash não batia com `file://` URL) — trocado por `fileURLToPath`+`path.resolve`; (2) redirect do consumo de magic link apontava para `http://0.0.0.0:3000` em vez do domínio público (mesma raiz do problema de `CF-Connecting-IP` da Fase 2: o app não vê o host real atrás do Traefik/Cloudflare) — trocado para usar `serverConfig().appBaseUrl`; (3) `serverConfig()` exigia todas as 6 variáveis de uma vez mesmo quando só uma era usada, bloqueando a rota de consumo por falta de credenciais do Mercado Pago que ela nem usa — convertido para getters lazy (cada campo só valida ao ser acessado). `APP_BASE_URL=https://chess.dlsistemas.com.br` adicionado ao `.env` da VPS (não é segredo). Envio real de e-mail do magic link segue bloqueado pela mesma pendência de SMTP da Fase 2 — o link é criado no banco mesmo se o envio falhar, então o mecanismo já foi validado ponta a ponta usando o token direto do banco. **Revisão final de toda a branch** (modelo mais capaz) achou 0 Critical, 9 Important, 11 Minor; uma leva de correção única resolveu os 7 Important mais relevantes (oráculo de timing no pedido de magic link — envio de e-mail deixou de bloquear a resposta; bloqueio de 24h por terceiro — limite diário agora combina IP+e-mail e o limite de 2min é checado antes; rota de consumo sem tratamento de erro — agora com try/catch e redirect de erro; ataque de timing no login admin/cliente — `verifyPassword` sempre roda contra um hash dummy; limpeza de `magic_links` nunca implementada apesar do nome da Task 16 — adicionada e ligada ao cron; falta de rede de teste para a proteção de rotas — nova suíte lê o código-fonte e garante que toda rota sensível chama `resolveSession`/`rateLimit`; botão "criar senha" que faltava na página `/cliente` — adicionado). Revisão de acompanhamento confirmou todos os 7 endereçados, sem regressão. 2 Important e todos os 11 Minor foram conscientemente adiados para a Fase 4/5 (detalhes e justificativa completos na ledger `. superpowers/sdd/2026-09-16-fase3-auth/progress.md`): login por senha do cliente não reverifica `orders.status = 'paid'` (sem pedidos reais em produção ainda, sem risco imediato); `set-password` não gera entrada de auditoria nem invalida outras sessões (exigiria nova migration no enum de `access_log.event`). |
| 4 | Área do cliente (login opcional, aulas, troca de senha) | ✅ Concluída e verificada em produção (2026-09-16) — [design](docs/superpowers/specs/2026-09-16-fase4-lessons-design.md), [plano](docs/superpowers/plans/2026-09-16-fase4-lessons.md). Verificação end-to-end em `chess.dlsistemas.com.br` confirmou: admin consegue criar/editar/alternar publicação/excluir aulas via `/admin/aulas`, cada mudança é registrada em `access_log` como `admin_action` com evento `create_lesson`/`update_lesson`/`delete_lesson`; cliente vê em `/cliente` apenas as aulas publicadas, ordenadas por posição, e as não publicadas permanecem ocultas. Revisão final da branch achou 3 Important (URL de aula aceitava esquema `javascript:`/`data:`, risco de XSS armazenado; suíte de proteção de rotas checava `resolveSession` uma vez por arquivo em vez de por handler, deixando passar a remoção do guard de um dos dois handlers; atualização do `BACKLOG.md` da Task 10 nunca foi commitada) — todos corrigidos numa leva única de correção. |
| 5 | Painel admin (dashboard, configurações em DB) | ⏳ Não iniciada — o CRUD de aulas (`/admin/aulas`) já foi entregue como parte da Fase 4; resta apenas o dashboard e as configurações gerais. Decisão de arquitetura registrada: dados operacionais (produto, preço, textos) e credenciais de terceiros sem problema de bootstrap (ex.: token Mercado Pago) podem virar configuração editável no painel, guardada **criptografada** no banco; `DATABASE_URL` nunca pode ir para o banco (dependência circular) e fica sempre em `.env`. |
| 6 | Hardening de segurança e backups | ⏳ Não iniciada |

Cada fase, ao ser detalhada, ganha um spec em
`docs/superpowers/specs/YYYY-MM-DD-<fase>-design.md` e um plano de
implementação via skill `writing-plans`. Links serão adicionados aqui assim
que existirem.

## Regras fixas para todas as fases

- Nunca executar comando destrutivo ou mutação na VPS sem confirmação
  explícita do usuário antes.
- Nunca listar, modificar ou remover containers/processos que não pertençam
  a este projeto.
- Nunca commitar chaves, segredos ou `.env` reais no git.
- Toda mudança de schema via migration versionada em `migrations/`.
