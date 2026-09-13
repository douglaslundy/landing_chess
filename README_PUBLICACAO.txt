LANDING PAGE - XADREZ ESSENCIAL

ARQUIVOS DA PAGINA
- index.html: pagina completa e responsiva.
- assets/checkout.js: checkout transparente integrado ao backend.
- assets/capa-xadrez-essencial.png: capa atual do livro.
- assets/exercicio-tabuleiro.png: exemplo de exercicio com posicao limpa.
- assets/gabarito-visual.png: exemplo de solucao anotada no tabuleiro.
- api/: endpoints serverless para Vercel.
- migrations/: schema PostgreSQL.

INFORMACOES DA VERSAO ATUAL
- Titulo: Xadrez Essencial.
- Autor: Douglas Lundy.
- Formato: PDF digital de 7 x 10 polegadas.
- Extensao: 619 paginas organizadas em 10 volumes.
- Conteudo visual: 300 diagramas.
- Treinamento: 229 exercicios praticos com tabuleiro.
- Respostas: 229 gabaritos visuais com setas, casas criticas, notacao e explicacao tecnica.

CONFIGURACAO DO CHECKOUT
- O checkout agora e integrado na propria pagina via Mercado Pago Checkout Transparente.
- Configure as variaveis de ambiente na Vercel conforme README.md e .env.example.
- Execute as migrations PostgreSQL antes de publicar em producao.
- Cadastre o webhook: {APP_BASE_URL}/api/mercadopago/webhook.

PRECO
- Lancamento: R$ 39,90.
- O valor oficial usado para cobranca fica no servidor em api/_lib/constants.js.
- Se alterar o preco, atualize tambem os textos visiveis, o schema Product/Offer e os testes.

PUBLICACAO
- Este projeto agora precisa de Vercel Functions e PostgreSQL persistente.
- Hospedagens puramente estaticas, como GitHub Pages, nao executam o backend de pagamento.
- Publique com as variaveis de ambiente configuradas e redeploy apos qualquer mudanca de segredo.

DADOS A REVISAR ANTES DE PUBLICAR
- Credenciais Mercado Pago de producao.
- Chave Pix ativa no Mercado Pago.
- Banco PostgreSQL e migrations aplicadas.
- Webhook de pagamentos configurado e simulado.
- SMTP transacional validado.
- PRODUCT_ACCESS_URL correto.
- Politica de privacidade, termos de compra, suporte e condicoes comerciais reais.

AUTOR
Douglas Lundy
