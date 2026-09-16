'use client';

export default function LogoutButton({ endpoint, redirectTo }) {
  async function handleClick() {
    await fetch(endpoint, { method: 'POST' });
    window.location.href = redirectTo;
  }
  return <button type="button" onClick={handleClick}>Sair</button>;
}
