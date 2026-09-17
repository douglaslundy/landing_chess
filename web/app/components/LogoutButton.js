'use client';

export default function LogoutButton({ endpoint, redirectTo, className }) {
  async function handleClick() {
    await fetch(endpoint, { method: 'POST' });
    window.location.href = redirectTo;
  }
  return <button type="button" className={className} onClick={handleClick}>Sair</button>;
}
