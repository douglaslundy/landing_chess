import { query } from './db.js';

export async function getDashboardStats() {
  const [totals, byStatus, recent] = await Promise.all([
    query(
      `select count(*)::int as count, coalesce(sum(amount_cents), 0)::int as revenue_cents
       from orders where status = 'paid'`,
      []
    ),
    query('select status, count(*)::int as count from orders group by status', []),
    query(
      `select id, public_token, buyer_name, buyer_email, product_title, amount_cents, currency, status, created_at
       from orders order by created_at desc limit 20`,
      []
    )
  ]);

  return {
    paidOrders: totals.rows[0].count,
    totalRevenueCents: totals.rows[0].revenue_cents,
    ordersByStatus: byStatus.rows.reduce((acc, row) => {
      acc[row.status] = row.count;
      return acc;
    }, {}),
    recentOrders: recent.rows
  };
}
