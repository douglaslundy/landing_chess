'use client';
import { useState } from 'react';

export default function ClientEntrarPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);

  async function handleMagicLink(event) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    const response = await fetch('/api/client/magic-link/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const body = await response.json().catch(() => ({}));
    setMessage(body.message || 'Se este e-mail tiver uma compra confirmada, enviamos um link de acesso.');
  }

  async function handlePasswordLogin(event) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    const response = await fetch('/api/client/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    if (!response.ok) {
      setError('E-mail ou senha inválidos.');
      return;
    }
    window.location.href = '/cliente';
  }

  return (
    <main style={{ padding: 32, fontFamily: 'sans-serif', maxWidth: 360 }}>
      <h1>Entrar</h1>
      <label>
        E-mail
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>

      <form onSubmit={handleMagicLink}>
        <button type="submit">Receber link por e-mail</button>
      </form>
      {message && <p>{message}</p>}

      <form onSubmit={handlePasswordLogin}>
        <label>
          Senha (se você já criou uma)
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <p role="alert">{error}</p>}
        <button type="submit">Entrar com senha</button>
      </form>
    </main>
  );
}
