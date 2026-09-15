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
| 1 | Infra na VPS (recon read-only, Docker, Traefik, Postgres, rollback) | ✅ Concluída (2026-09-15) — [design](docs/superpowers/specs/2026-09-14-fase1-infra-vps-design.md), [plano](docs/superpowers/plans/2026-09-15-fase1-infra-vps.md). `https://chess.dlsistemas.com.br` no ar, TLS válido, app↔postgres ok, isolamento validado (diff antes/depois só mostra os 2 containers novos). |
| 2 | Migrar app atual (landing + checkout + webhook + cron) para Next.js | ⏳ Não iniciada |
| 3 | Autenticação (admin + cliente) + log de acesso | ⏳ Não iniciada |
| 4 | Área do cliente (login opcional, aulas, troca de senha) | ⏳ Não iniciada |
| 5 | Painel admin (dashboard, CRUD de aulas, configurações em DB) | ⏳ Não iniciada |
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
