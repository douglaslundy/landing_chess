import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { CLIENT_COOKIE } from '../../lib/auth/cookies.js';
import { resolveSession } from '../../lib/auth/guard.js';
import LogoutButton from '../components/LogoutButton.js';

export default async function ClientHomePage() {
  const jar = await cookies();
  const token = jar.get(CLIENT_COOKIE)?.value || null;
  const session = await resolveSession(token, 'client');
  if (!session) redirect('/cliente/entrar');

  return (
    <main style={{ padding: 32, fontFamily: 'sans-serif' }}>
      <h1>Área do cliente</h1>
      <p>Em construção.</p>
      <LogoutButton endpoint="/api/client/logout" redirectTo="/cliente/entrar" />
    </main>
  );
}
