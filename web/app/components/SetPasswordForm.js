'use client';
import { useState } from 'react';

export default function SetPasswordForm() {
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    const response = await fetch('/api/client/set-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    if (!response.ok) {
      setError('Não foi possível salvar a senha. Verifique se tem pelo menos 8 caracteres.');
      return;
    }
    setMessage('Senha criada com sucesso.');
    setPassword('');
  }

  return (
    <form onSubmit={handleSubmit}>
      <label>
        Criar senha de acesso
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required />
      </label>
      {error && <p role="alert">{error}</p>}
      {message && <p>{message}</p>}
      <button type="submit">Salvar senha</button>
    </form>
  );
}
