import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ADMIN_COOKIE } from '../../../lib/auth/cookies.js';
import { resolveSession } from '../../../lib/auth/guard.js';
import AdminNav from '../AdminNav.js';
import AulasManager from './AulasManager.js';

export default async function AdminAulasPage() {
  const jar = await cookies();
  const token = jar.get(ADMIN_COOKIE)?.value || null;
  const session = await resolveSession(token, 'admin');
  if (!session) redirect('/admin/login');

  return (
    <div className="admin-shell">
      <AdminNav current="/admin/aulas" />
      <AulasManager />
    </div>
  );
}
