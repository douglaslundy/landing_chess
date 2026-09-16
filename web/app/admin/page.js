import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ADMIN_COOKIE } from '../../lib/auth/cookies.js';
import { resolveSession } from '../../lib/auth/guard.js';
import LogoutButton from '../components/LogoutButton.js';

export default async function AdminHomePage() {
  const jar = await cookies();
  const token = jar.get(ADMIN_COOKIE)?.value || null;
  const session = await resolveSession(token, 'admin');
  if (!session) redirect('/admin/login');

  return (
    <main style={{ padding: 32, fontFamily: 'sans-serif' }}>
      <h1>Painel admin</h1>
      <p>Em construção.</p>
      <LogoutButton endpoint="/api/admin/logout" redirectTo="/admin/login" />
    </main>
  );
}
