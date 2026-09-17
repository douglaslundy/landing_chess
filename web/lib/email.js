import nodemailer from 'nodemailer';
import { serverConfig } from './env.js';
import { getSmtpSettings, getProductAccessUrl } from './settings.js';
import { withTransaction, query } from './db.js';
import { MAGIC_LINK_TTL_SECONDS } from './constants.js';
import { createMagicLink } from './auth/magicLink.js';

async function createTransporter() {
  const cfg = await getSmtpSettings();
  const mailer = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.password },
    requireTLS: !cfg.secure
  });
  return { mailer, cfg };
}

export function buildEmail(order, { magicLinkUrl, productAccessUrl } = {}) {
  const subject = 'Seu acesso ao Xadrez Essencial';
  const magicLinkText = magicLinkUrl
    ? `\n\nVocê também já pode entrar direto na área de aulas por aqui (link de uso único, válido por 30 minutos): ${magicLinkUrl}`
    : '';
  const text = [
    `Olá, ${order.buyer_name}.`,
    '',
    `Recebemos a confirmação do pagamento da compra ${order.id}.`,
    `Acesse o produto digital aqui: ${productAccessUrl}`,
    '',
    'Este link é fixo e pode ser compartilhado. Ele não é um controle individual de acesso.',
    '',
    'Douglas Lundy'
  ].join('\n') + magicLinkText;
  const magicLinkHtml = magicLinkUrl
    ? `<p><a href="${magicLinkUrl}">Entrar na área de aulas agora</a> (link de uso único, válido por 30 minutos).</p>`
    : '';
  const html = `
    <p>Olá, ${escapeHtml(order.buyer_name)}.</p>
    <p>Recebemos a confirmação do pagamento da compra <strong>${order.id}</strong>.</p>
    <p><a href="${productAccessUrl}" style="display:inline-block;background:#d10e17;color:#fff;padding:14px 18px;border-radius:8px;text-decoration:none;font-weight:700">Acessar ${escapeHtml(order.product_title)}</a></p>
    <p>Se o botão não abrir, use este link:<br><a href="${productAccessUrl}">${productAccessUrl}</a></p>
    ${magicLinkHtml}
    <p><small>Este link é fixo e pode ser compartilhado. Ele não é um controle individual de acesso.</small></p>
  `;
  return { subject, text, html };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[char]));
}

export async function processEmailOutbox(limit = 10) {
  const jobs = await withTransaction(async (client) => {
    const result = await client.query(
      `
      select e.*, o.buyer_name, o.buyer_email, o.product_title
      from outbox_emails e
      join orders o on o.id = e.order_id
      where e.status in ('pending', 'failed')
        and e.next_attempt_at <= now()
      order by e.created_at
      limit $1
      for update skip locked
      `,
      [limit]
    );
    const ids = result.rows.map((row) => row.id);
    if (ids.length) {
      await client.query(
        `update outbox_emails set status = 'sending', updated_at = now() where id = any($1::uuid[])`,
        [ids]
      );
    }
    return result.rows;
  });

  if (!jobs.length) return [];

  const { mailer, cfg } = await createTransporter();
  const { appBaseUrl } = serverConfig();
  const productAccessUrl = await getProductAccessUrl();

  const results = [];
  for (const job of jobs) {
    try {
      const magicLinkToken = await createMagicLink(job.buyer_email, MAGIC_LINK_TTL_SECONDS);
      const magicLinkUrl = `${appBaseUrl}/api/client/magic-link/consume?token=${magicLinkToken}`;
      const message = buildEmail(job, { magicLinkUrl, productAccessUrl });
      const info = await mailer.sendMail({
        from: cfg.from,
        to: job.buyer_email,
        replyTo: cfg.replyTo,
        subject: message.subject,
        text: message.text,
        html: message.html,
        headers: { 'X-Order-Id': job.order_id }
      });
      await query(
        `
        update outbox_emails set
          status = 'sent',
          attempts = attempts + 1,
          provider_message_id = $2,
          sent_at = now(),
          last_error = null,
          updated_at = now()
        where id = $1
        `,
        [job.id, info.messageId || null]
      );
      await query(
        `update orders set email_sent_at = now(), updated_at = now() where id = $1`,
        [job.order_id]
      );
      results.push({ id: job.id, status: 'sent' });
    } catch (error) {
      await query(
        `
        update outbox_emails set
          status = 'failed',
          attempts = attempts + 1,
          next_attempt_at = now() + ((least(attempts + 1, 6) * least(attempts + 1, 6)) * interval '5 minutes'),
          last_error = left($2, 500),
          updated_at = now()
        where id = $1
        `,
        [job.id, error.message]
      );
      results.push({ id: job.id, status: 'failed', error: error.message });
    }
  }
  return results;
}

export async function sendTestEmail(to) {
  const { mailer, cfg } = await createTransporter();
  await mailer.sendMail({
    from: cfg.from,
    to,
    replyTo: cfg.replyTo,
    subject: 'E-mail de teste — Xadrez Essencial',
    text: 'Este é um e-mail de teste para confirmar que a configuração SMTP está funcionando.',
    html: '<p>Este é um e-mail de teste para confirmar que a configuração SMTP está funcionando.</p>'
  });
}

export async function sendMagicLinkEmail(email, token) {
  const { mailer, cfg } = await createTransporter();
  const { appBaseUrl } = serverConfig();
  const url = `${appBaseUrl}/api/client/magic-link/consume?token=${token}`;
  await mailer.sendMail({
    from: cfg.from,
    to: email,
    replyTo: cfg.replyTo,
    subject: 'Seu link de acesso — Xadrez Essencial',
    text: `Use este link para entrar na sua área de aulas (válido por 30 minutos, uso único):\n${url}`,
    html: `<p>Use este link para entrar na sua área de aulas (válido por 30 minutos, uso único):</p><p><a href="${url}">${url}</a></p>`
  });
}
