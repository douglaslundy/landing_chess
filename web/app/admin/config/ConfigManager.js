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

function ConfiguredBadge({ ok }) {
  return ok
    ? <span className="admin-badge admin-badge--ok">configurado ✓</span>
    : <span className="admin-badge admin-badge--pending">não configurado</span>;
}

export default function ConfigManager() {
  const [form, setForm] = useState(EMPTY_FORM);
  const [original, setOriginal] = useState(EMPTY_FORM);
  const [configured, setConfigured] = useState({});
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const [testEmailTo, setTestEmailTo] = useState('');
  const [testEmailStatus, setTestEmailStatus] = useState(null);

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
        if (key === 'smtp_secure') {
          nextForm[key] = value === 'true' || value === true;
        } else if (key === 'smtp_port' || key === 'product_amount_cents') {
          nextForm[key] = Number(value);
        } else {
          nextForm[key] = value;
        }
      }
    }
    setForm(nextForm);
    setOriginal(nextForm);
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
    const payload = {};
    for (const key of Object.keys(EMPTY_FORM)) {
      if (ENCRYPTED_KEYS.has(key)) {
        if (form[key]) payload[key] = form[key];
      } else if (form[key] !== original[key]) {
        payload[key] = form[key];
      }
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

  async function handleTestEmail() {
    setTestEmailStatus(null);
    if (!testEmailTo) {
      setTestEmailStatus({ type: 'error', message: 'Informe um e-mail de destino.' });
      return;
    }
    const response = await fetch('/api/admin/settings/test-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: testEmailTo })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setTestEmailStatus({ type: 'error', message: body.error || 'Falha ao enviar. Confira as credenciais SMTP salvas.' });
      return;
    }
    setTestEmailStatus({ type: 'success', message: `E-mail de teste enviado para ${testEmailTo}.` });
  }

  return (
    <>
      <h1 className="admin-title">Configurações</h1>

      <form onSubmit={handleSubmit}>
        <section className="admin-card">
          <div className="admin-card-head">
            <h2 className="admin-subtitle">Produto</h2>
          </div>
          <label className="admin-field">
            Título
            <input
              className="admin-input"
              value={form.product_title}
              onChange={(e) => updateField('product_title', e.target.value)}
              required
            />
          </label>
          <label className="admin-field">
            Descrição
            <textarea
              className="admin-input"
              value={form.product_description}
              onChange={(e) => updateField('product_description', e.target.value)}
            />
          </label>
          <label className="admin-field">
            Preço <span className="admin-field-hint">(em centavos, ex: 3990 = R$ 39,90)</span>
            <input
              className="admin-input"
              type="number"
              value={form.product_amount_cents}
              onChange={(e) => updateField('product_amount_cents', e.target.value)}
              required
            />
          </label>
          <label className="admin-field">
            Moeda
            <input
              className="admin-input"
              value={form.product_currency}
              onChange={(e) => updateField('product_currency', e.target.value)}
              required
            />
          </label>
        </section>

        <section className="admin-card">
          <div className="admin-card-head">
            <h2 className="admin-subtitle">Mercado Pago</h2>
          </div>
          <label className="admin-field">
            Chave pública
            <input
              className="admin-input"
              value={form.mercadopago_public_key}
              onChange={(e) => updateField('mercadopago_public_key', e.target.value)}
            />
          </label>
          <label className="admin-field">
            Access token <ConfiguredBadge ok={configured.mercadopago_access_token} />
            <input
              className="admin-input"
              type="password"
              value={form.mercadopago_access_token}
              onChange={(e) => updateField('mercadopago_access_token', e.target.value)}
              placeholder="Deixe em branco para manter o atual"
            />
          </label>
          <label className="admin-field">
            Webhook secret <ConfiguredBadge ok={configured.mercadopago_webhook_secret} />
            <input
              className="admin-input"
              type="password"
              value={form.mercadopago_webhook_secret}
              onChange={(e) => updateField('mercadopago_webhook_secret', e.target.value)}
              placeholder="Deixe em branco para manter o atual"
            />
          </label>
        </section>

        <section className="admin-card">
          <div className="admin-card-head">
            <h2 className="admin-subtitle">E-mail (SMTP)</h2>
            <p>Dados do servidor de e-mail usado para enviar a confirmação de compra e os links de acesso aos clientes.</p>
          </div>
          <label className="admin-field">
            Host
            <input
              className="admin-input"
              value={form.smtp_host}
              onChange={(e) => updateField('smtp_host', e.target.value)}
              placeholder="ex.: smtp.gmail.com"
            />
          </label>
          <label className="admin-field">
            Porta
            <input
              className="admin-input"
              type="number"
              value={form.smtp_port}
              onChange={(e) => updateField('smtp_port', e.target.value)}
              placeholder="587 (TLS) ou 465 (SSL)"
            />
          </label>
          <label className="admin-checkbox-field">
            <input
              type="checkbox"
              checked={form.smtp_secure}
              onChange={(e) => updateField('smtp_secure', e.target.checked)}
            />
            Conexão segura (TLS) <span className="admin-field-hint">— marque se a porta for 465, deixe desmarcado para 587</span>
          </label>
          <label className="admin-field">
            Usuário
            <input
              className="admin-input"
              value={form.smtp_user}
              onChange={(e) => updateField('smtp_user', e.target.value)}
              placeholder="ex.: seuemail@gmail.com"
            />
          </label>
          <label className="admin-field">
            Senha <ConfiguredBadge ok={configured.smtp_password} />
            <input
              className="admin-input"
              type="password"
              value={form.smtp_password}
              onChange={(e) => updateField('smtp_password', e.target.value)}
              placeholder="senha de app do provedor (não é a senha normal da conta), deixe em branco para manter a atual"
            />
          </label>
          <label className="admin-field">
            Remetente
            <input
              className="admin-input"
              value={form.email_from}
              onChange={(e) => updateField('email_from', e.target.value)}
              placeholder="ex.: contato@seudominio.com.br"
            />
          </label>
          <label className="admin-field">
            Responder para <span className="admin-field-hint">(opcional)</span>
            <input
              className="admin-input"
              value={form.email_reply_to}
              onChange={(e) => updateField('email_reply_to', e.target.value)}
              placeholder="seu e-mail de suporte, ex.: suporte@seudominio.com.br"
            />
            <span className="admin-field-hint">
              Todo e-mail é enviado ao cliente que comprou, não a este endereço — este campo só define para onde vai a
              resposta se o cliente clicar em &quot;Responder&quot; no e-mail recebido. Deixe em branco para que as
              respostas voltem ao próprio endereço de remetente.
            </span>
          </label>

          <div className="admin-card-head" style={{ marginTop: 24 }}>
            <h2 className="admin-subtitle" style={{ fontSize: '1.05rem' }}>Testar envio</h2>
            <p>Envia um e-mail de teste usando as configurações de SMTP já salvas (salve antes de testar uma mudança).</p>
          </div>
          <label className="admin-field">
            Enviar teste para
            <input
              className="admin-input"
              type="email"
              value={testEmailTo}
              onChange={(e) => setTestEmailTo(e.target.value)}
              placeholder="seu-email@exemplo.com"
            />
          </label>
          {testEmailStatus && (
            <p className={`admin-alert admin-alert--${testEmailStatus.type === 'success' ? 'success' : 'error'}`}>
              {testEmailStatus.message}
            </p>
          )}
          <div className="admin-btn-row">
            <button type="button" className="admin-btn admin-btn-ghost" onClick={handleTestEmail}>
              Enviar e-mail de teste
            </button>
          </div>
        </section>

        <section className="admin-card">
          <div className="admin-card-head">
            <h2 className="admin-subtitle">Acesso ao produto</h2>
          </div>
          <label className="admin-field">
            URL de acesso <ConfiguredBadge ok={configured.product_access_url} />
            <input
              className="admin-input"
              type="password"
              value={form.product_access_url}
              onChange={(e) => updateField('product_access_url', e.target.value)}
              placeholder="Deixe em branco para manter a atual"
            />
          </label>
        </section>

        {error && <p className="admin-alert admin-alert--error" role="alert">{error}</p>}
        {message && <p className="admin-alert admin-alert--success">{message}</p>}
        <div className="admin-btn-row">
          <button type="submit" className="admin-btn">Salvar</button>
        </div>
      </form>
    </>
  );
}
