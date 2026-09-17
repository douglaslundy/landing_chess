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
| 5 | Painel admin (dashboard, configurações em DB) | ✅ Concluída e verificada em produção (2026-09-17) — [design](docs/superpowers/specs/2026-09-16-fase5-settings-dashboard-design.md), [plano](docs/superpowers/plans/2026-09-16-fase5-settings-dashboard.md). Tabela `settings` (chave/valor, alguns valores criptografados com AES-256-GCM, chave `SETTINGS_ENCRYPTION_KEY` só em `.env`) com fallback pro `.env` durante a transição. `/admin/config`: produto (título/descrição/preço/moeda, texto puro), Mercado Pago (chave pública texto puro; access token e webhook secret criptografados), SMTP (host/porta/seguro/usuário texto puro; senha criptografada), URL de acesso ao produto (criptografada) — tudo editável pela tela, sem precisar de SSH. `/admin` ganhou dashboard de vendas (pedidos pagos, receita total, contagem por status, pedidos recentes). Refatorados 5 arquivos da Fase 2 (`orders.js`, `mercadopago.js`, `email.js`, `http.js`, `api/config/route.js`) pra ler do `settings` ou do próprio snapshot do pedido em vez da constante `PRODUCT` fixa — validação de fraude no webhook continua comparando com o que foi gravado no pedido na hora da compra, nunca com o preço atual. Verificação end-to-end: edição de preço refletida em `/api/config` e revertida; log de auditoria (`update_settings` em `access_log`) confirmado; dashboard bate com o banco. Revisão final da branch (16 commits) achou 1 Critical + 4 Important, todos corrigidos numa leva única de correção com revisão de acompanhamento aprovando tudo: (1) segredo do webhook do Mercado Pago nunca foi conectado à nova camada de settings — a rota do webhook continuava lendo só do `.env`, então cadastrar o segredo só pela tela fazia todo webhook real retornar 401 silenciosamente enquanto a UI dizia "configurado"; (2) achado ao vivo durante o deploy, mesma classe de bug já corrigida uma vez na Fase 3: `getMercadoPagoSettings()` exigia a chave pública E o access token juntos, quebrando `/api/config` quando só a chave pública estava cadastrada — convertido pra getters lazy; (3) a tela de configurações enviava o formulário inteiro a cada salvamento, o que bloqueava o primeiro salvamento numa instalação nova (campo `email_from` vazio reprovando a própria validação) e gravava valores padrão de SMTP da UI no banco, sobrescrevendo silenciosamente o que fosse configurado depois no `.env` — corrigido pra só enviar campos realmente alterados; (4) `publicOrder` passou a lançar erro (500) em vez de degradar graciosamente quando `PRODUCT_ACCESS_URL` não está configurado, o que podia devolver 500 numa resposta de pagamento já aprovado pelo Mercado Pago — revertido para degradar para `null`. Um gap de sequenciamento na remoção da constante `PRODUCT` de `constants.js` foi encontrado e corrigido duas vezes durante a revisão de pré-execução do próprio plano, antes de qualquer implementação começar. |
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
