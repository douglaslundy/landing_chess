# Fase 1 — Infraestrutura na VPS

Status: aprovado, aguardando geração do plano de implementação.
Depende de: nenhuma fase anterior (fase inicial).
Bloqueia: Fase 2 (migração do app para Next.js), que precisa do ambiente aqui descrito já de pé.

## Contexto do projeto (para sessões futuras sem histórico da conversa)

Este spec cobre só a Fase 1 do backlog em `BACKLOG.md` (raiz do repo). Decisões
de arquitetura já fechadas para o projeto inteiro (não específicas desta
fase, mas necessárias para entender o porquê das escolhas abaixo):

- Migração completa da Vercel para uma VPS própria.
- Next.js (App Router) único cobrindo landing page, checkout, webhook,
  reconciliação, painel admin e área do cliente.
- Isolamento via Docker: containers próprios, nunca compartilhar
  processo/rede/porta com outros projetos já hospedados na mesma VPS.
- Conteúdo das aulas = apenas links externos cadastrados pelo admin (sem
  upload/armazenamento de arquivo).
- Nunca persistir dado de cartão de crédito.

## A VPS (144.91.92.70) — o que já existe

Levantado por reconhecimento somente leitura em 2026-09-14 (`docker ps`,
`docker inspect`, `docker network inspect`, leitura de `/opt/INFRA-README.md`
e crontab root). Não foi feita nenhuma alteração nesse levantamento.

- Ubuntu 24.04, kernel 6.8, Docker 29.6.1, ~11GB RAM (6GB livres), 157GB
  disco livre.
- **Traefik v2.11/v3** já roda como reverse proxy único das portas 80/443,
  com SSL automático via Let's Encrypt (`certresolver: letsencrypt`),
  configurado por **labels do Docker** — não existe Nginx manual para editar.
- Convenção já em uso por outros sistemas (`corridas`, `mecanicapro`,
  `supabase-syscursos`, `supabase-corridas`, `evolution`, `fotosaas`,
  `vps-monitor`): cada sistema mora isolado em `/opt/<nome>/`, com seu
  próprio `docker-compose.yml`; o banco fica numa rede interna própria (sem
  porta exposta ao host); só o container que precisa ser roteado
  publicamente entra também na rede externa `proxy`.
- Existe um crontab **root global** compartilhado por múltiplos projetos
  (ex.: `/opt/corridas/cron-jobs.sh ...`). Este projeto **não deve
  adicionar linhas nesse crontab** — jobs agendados deste projeto rodam
  dentro do próprio processo da aplicação.
- Nenhuma pasta `/opt/xadrez*` existe ainda — sem colisão de nome.
- Documentação oficial de "como adicionar novo sistema" em
  `/opt/INFRA-README.md` na própria VPS — este spec segue exatamente essa
  convenção.

## Design

### Localização e isolamento

- Diretório do projeto na VPS: `/opt/xadrez-essencial/`
- Código-fonte clonado em `/opt/xadrez-essencial/src` (git).
- `docker-compose.yml` próprio, dois serviços nesta fase:
  - `postgres`: imagem `postgres:17-alpine`, volume nomeado
    `xadrez_postgres_data`, rede `xadrez_internal` (interna, `external:
    false`), **sem** `ports:` mapeado para o host.
  - `app`: esqueleto mínimo Next.js (só para validar o pipeline
    ponta-a-ponta nesta fase — funcionalidade real entra na Fase 2). Entra
    em `xadrez_internal` (para falar com o Postgres) e na rede externa
    `proxy` (já existente na VPS, `external: true`) para o Traefik
    enxergar o container.

### Roteamento (Traefik, via labels no serviço `app`)

Mesmo padrão usado pelo serviço `corridas-app` (verificado por
`docker inspect`):

```yaml
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
```

O middleware `redirect-to-https` já existe globalmente (criado pelo
`corridas`); se não for reaproveitável entre projetos, criar uma cópia com
nome `xadrez-redirect-to-https` — confirmar isso no momento da implementação
antes de assumir o middleware compartilhado.

DNS: `chess.dlsistemas.com.br` deve ter um registro **A** apontando para
`144.91.92.70`, criado pelo usuário no provedor de DNS (fora do alcance da
automação). Enquanto o DNS não propaga, testar via header `Host` manual ou
router temporário por IP.

### Segredos

- Arquivo `/opt/xadrez-essencial/.env`, permissão `600`, nunca commitado.
- Gerado na hora do deploy (senha do Postgres, secrets de sessão/auth),
  nunca reaproveitando segredo de outro projeto da VPS.
- Variáveis vindas do `.env.example` atual do repo (Mercado Pago, SMTP
  etc.) continuam as mesmas nesta fase; a Fase 5 é que move isso para
  configuração em banco.

### Deploy (fluxo manual, mesmo padrão do `corridas`)

1. `git clone`/`git pull` em `/opt/xadrez-essencial/src`
2. `docker build` da imagem da app
3. `docker compose up -d` (ou `restart app` em atualizações)

Sem pipeline de CI/CD novo nesta fase — decisão consciente de YAGNI; pode
ser revisitado depois se o volume de deploys justificar.

### Jobs agendados

Substituem o Vercel Cron (`/api/cron/reconcile`) sem tocar no crontab root
compartilhado: agendamento via `node-cron` (ou equivalente) dentro do
próprio processo Next.js, com um lock/idempotência simples para não rodar
duplicado se o processo reiniciar.

### Rollback

Tudo contido em `/opt/xadrez-essencial/`: `docker compose down` remove
containers e não afeta nenhum outro projeto. Nenhuma alteração é feita fora
desse diretório, exceto:
- criação do registro DNS (reversível pelo usuário no provedor de DNS)
- entrada nas labels do Traefik (só afeta roteamento do próprio domínio
  `chess.dlsistemas.com.br`)

### Critério de sucesso da fase

`https://chess.dlsistemas.com.br` responde com certificado TLS válido,
servindo a página esqueleto do Next.js; o container `app` consegue
conectar no `postgres` pela rede interna; nenhum container/rede/porta de
outro projeto foi alterado (validado comparando `docker ps` antes/depois).

## Fora de escopo nesta fase

- Migração da lógica real de checkout/webhook (Fase 2).
- Corte de DNS definitivo / desligamento da Vercel (acontece só ao final
  da Fase 2, depois de validar tudo rodando em paralelo).
- Autenticação, admin, área do cliente (Fases 3–5).
