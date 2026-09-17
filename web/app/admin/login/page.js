'use client';
import { useState } from 'react';

export default function AdminLoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    const response = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    if (!response.ok) {
      setError('E-mail ou senha inválidos.');
      return;
    }
    window.location.href = '/admin';
  }

  return (
    <div className="admin-shell admin-shell--narrow">
      <div className="admin-brand" style={{ textAlign: 'center', marginBottom: 28 }}>
        Xadrez <span>Essencial</span> — Admin
      </div>
      <section className="admin-card">
        <div className="admin-card-head">
          <h1 className="admin-subtitle" style={{ fontSize: '1.6rem' }}>Login</h1>
          <p>Acesse o painel administrativo.</p>
        </div>
        <form onSubmit={handleSubmit}>
          <label className="admin-field">
            E-mail
            <input
              className="admin-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label className="admin-field">
            Senha
            <input
              className="admin-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          {error && <p className="admin-alert admin-alert--error" role="alert">{error}</p>}
          <div className="admin-btn-row">
            <button type="submit" className="admin-btn">Entrar</button>
          </div>
        </form>
      </section>
    </div>
  );
}
