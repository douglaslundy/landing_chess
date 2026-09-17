import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ADMIN_COOKIE } from '../../lib/auth/cookies.js';
import { resolveSession } from '../../lib/auth/guard.js';
import { getDashboardStats } from '../../lib/dashboard.js';
import AdminNav from './AdminNav.js';

export default async function AdminHomePage() {
  const jar = await cookies();
  const token = jar.get(ADMIN_COOKIE)?.value || null;
  const session = await resolveSession(token, 'admin');
  if (!session) redirect('/admin/login');

  const stats = await getDashboardStats();

  return (
    <div className="admin-shell">
      <AdminNav current="/admin" />
      <h1 className="admin-title">Painel admin</h1>

      <section className="admin-card">
        <div className="admin-card-head">
          <h2 className="admin-subtitle">Vendas</h2>
        </div>
        <div className="admin-grid admin-grid--stats">
          <div className="admin-stat">
            <div className="admin-stat-label">Pedidos pagos</div>
            <div className="admin-stat-value">{stats.paidOrders}</div>
          </div>
          <div className="admin-stat">
            <div className="admin-stat-label">Receita total</div>
            <div className="admin-stat-value">R$ {(stats.totalRevenueCents / 100).toFixed(2)}</div>
          </div>
          {Object.entries(stats.ordersByStatus).map(([status, count]) => (
            <div className="admin-stat" key={status}>
              <div className="admin-stat-label">{status}</div>
              <div className="admin-stat-value">{count}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="admin-card">
        <div className="admin-card-head">
          <h2 className="admin-subtitle">Pedidos recentes</h2>
        </div>
        {stats.recentOrders.length ? (
          <table className="admin-table">
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
        ) : (
          <p className="admin-empty">Nenhum pedido ainda.</p>
        )}
      </section>
    </div>
  );
}
