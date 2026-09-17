import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ADMIN_COOKIE } from '../../lib/auth/cookies.js';
import { resolveSession } from '../../lib/auth/guard.js';
import { getDashboardStats } from '../../lib/dashboard.js';
import LogoutButton from '../components/LogoutButton.js';

export default async function AdminHomePage() {
  const jar = await cookies();
  const token = jar.get(ADMIN_COOKIE)?.value || null;
  const session = await resolveSession(token, 'admin');
  if (!session) redirect('/admin/login');

  const stats = await getDashboardStats();

  return (
    <main style={{ padding: 32, fontFamily: 'sans-serif' }}>
      <h1>Painel admin</h1>
      <p>
        <Link href="/admin/aulas">Gerenciar aulas</Link>
        {' · '}
        <Link href="/admin/config">Configurações</Link>
      </p>

      <h2>Vendas</h2>
      <p>Pedidos pagos: {stats.paidOrders}</p>
      <p>Receita total: R$ {(stats.totalRevenueCents / 100).toFixed(2)}</p>
      <ul>
        {Object.entries(stats.ordersByStatus).map(([status, count]) => (
          <li key={status}>{status}: {count}</li>
        ))}
      </ul>

      <h2>Pedidos recentes</h2>
      <table>
        <thead>
          <tr>
            <th>Cliente</th>
            <th>Produto</th>
            <th>Valor</th>
            <th>Status</th>
            <th>Data</th>
          </tr>
        </thead>
        <tbody>
          {stats.recentOrders.map((order) => (
            <tr key={order.id}>
              <td>{order.buyer_name}</td>
              <td>{order.product_title}</td>
              <td>R$ {(order.amount_cents / 100).toFixed(2)}</td>
              <td>{order.status}</td>
              <td>{new Date(order.created_at).toLocaleDateString('pt-BR')}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <LogoutButton endpoint="/api/admin/logout" redirectTo="/admin/login" />
    </main>
  );
}
