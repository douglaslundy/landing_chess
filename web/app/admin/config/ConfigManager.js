'use client';
import { useEffect, useState } from 'react';

const EMPTY_FORM = {
  product_title: '',
  product_description: '',
  product_amount_cents: 0,
  product_currency: 'BRL',
  mercadopago_public_key: '',
  mercadopago_access_token: '',
  mercadopago_webhook_secret: '',
  smtp_host: '',
  smtp_port: 587,
  smtp_secure: false,
  smtp_user: '',
  smtp_password: '',
  email_from: '',
  email_reply_to: '',
  product_access_url: ''
};

const ENCRYPTED_KEYS = new Set([
  'mercadopago_access_token',
  'mercadopago_webhook_secret',
  'smtp_password',
  'product_access_url'
]);

export default function ConfigManager() {
  const [form, setForm] = useState(EMPTY_FORM);
  const [configured, setConfigured] = useState({});
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);

  async function loadSettings() {
    const response = await fetch('/api/admin/settings');
    if (!response.ok) return;
    const body = await response.json();
    const nextForm = { ...EMPTY_FORM };
    const nextConfigured = {};
    for (const [key, value] of Object.entries(body.settings)) {
      if (ENCRYPTED_KEYS.has(key)) {
        nextConfigured[key] = value?.configured || false;
      } else if (value !== null && value !== undefined) {
        nextForm[key] = value;
      }
    }
    setForm(nextForm);
    setConfigured(nextConfigured);
  }

  useEffect(() => {
    loadSettings();
  }, []);

  function updateField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    const payload = { ...form };
    for (const key of ENCRYPTED_KEYS) {
      if (!payload[key]) delete payload[key];
    }
    const response = await fetch('/api/admin/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      setError('Não foi possível salvar. Confira os campos.');
      return;
    }
    setMessage('Configurações salvas.');
    await loadSettings();
  }

  return (
    <main style={{ padding: 32, fontFamily: 'sans-serif', maxWidth: 720 }}>
      <h1>Configurações</h1>
      <form onSubmit={handleSubmit}>
        <h2>Produto</h2>
        <label>
          Título
          <input value={form.product_title} onChange={(e) => updateField('product_title', e.target.value)} required />
        </label>
        <label>
          Descrição
          <textarea value={form.product_description} onChange={(e) => updateField('product_description', e.target.value)} />
        </label>
        <label>
          Preço (em centavos, ex: 3990 = R$ 39,90)
          <input type="number" value={form.product_amount_cents} onChange={(e) => updateField('product_amount_cents', e.target.value)} required />
        </label>
        <label>
          Moeda
          <input value={form.product_currency} onChange={(e) => updateField('product_currency', e.target.value)} required />
        </label>

        <h2>Mercado Pago</h2>
        <label>
          Chave pública
          <input value={form.mercadopago_public_key} onChange={(e) => updateField('mercadopago_public_key', e.target.value)} />
        </label>
        <label>
          Access token {configured.mercadopago_access_token ? '(configurado ✓)' : '(não configurado)'}
          <input type="password" value={form.mercadopago_access_token} onChange={(e) => updateField('mercadopago_access_token', e.target.value)} placeholder="Deixe em branco para manter o atual" />
        </label>
        <label>
          Webhook secret {configured.mercadopago_webhook_secret ? '(configurado ✓)' : '(não configurado)'}
          <input type="password" value={form.mercadopago_webhook_secret} onChange={(e) => updateField('mercadopago_webhook_secret', e.target.value)} placeholder="Deixe em branco para manter o atual" />
        </label>

        <h2>E-mail (SMTP)</h2>
        <label>
          Host
          <input value={form.smtp_host} onChange={(e) => updateField('smtp_host', e.target.value)} />
        </label>
        <label>
          Porta
          <input type="number" value={form.smtp_port} onChange={(e) => updateField('smtp_port', e.target.value)} />
        </label>
        <label>
          <input type="checkbox" checked={form.smtp_secure} onChange={(e) => updateField('smtp_secure', e.target.checked)} />
          Conexão segura (TLS)
        </label>
        <label>
          Usuário
          <input value={form.smtp_user} onChange={(e) => updateField('smtp_user', e.target.value)} />
        </label>
        <label>
          Senha {configured.smtp_password ? '(configurada ✓)' : '(não configurada)'}
          <input type="password" value={form.smtp_password} onChange={(e) => updateField('smtp_password', e.target.value)} placeholder="Deixe em branco para manter a atual" />
        </label>
        <label>
          Remetente
          <input value={form.email_from} onChange={(e) => updateField('email_from', e.target.value)} />
        </label>
        <label>
          Responder para
          <input value={form.email_reply_to} onChange={(e) => updateField('email_reply_to', e.target.value)} />
        </label>

        <h2>Acesso ao produto</h2>
        <label>
          URL de acesso {configured.product_access_url ? '(configurada ✓)' : '(não configurada)'}
          <input type="password" value={form.product_access_url} onChange={(e) => updateField('product_access_url', e.target.value)} placeholder="Deixe em branco para manter a atual" />
        </label>

        {error && <p role="alert">{error}</p>}
        {message && <p>{message}</p>}
        <button type="submit">Salvar</button>
      </form>
    </main>
  );
}
