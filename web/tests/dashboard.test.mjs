import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();

vi.mock('pg', () => ({
  Pool: vi.fn().mockImplementation(function PoolMock() {
    return { query: queryMock };
  })
}));

const { resetPoolForTests } = await import('../lib/db.js');
const { getDashboardStats } = await import('../lib/dashboard.js');

describe('dashboard stats', () => {
  beforeEach(() => {
    process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
    resetPoolForTests();
    queryMock.mockReset();
  });

  afterEach(() => {
    delete process.env.DATABASE_URL;
  });

  it('aggregates paid order count, revenue, status breakdown, and recent orders', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ count: 5, revenue_cents: 19950 }] })
      .mockResolvedValueOnce({ rows: [{ status: 'paid', count: 5 }, { status: 'pending', count: 2 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'o1', buyer_name: 'Douglas' }] });

    const stats = await getDashboardStats();

    expect(stats.paidOrders).toBe(5);
    expect(stats.totalRevenueCents).toBe(19950);
    expect(stats.ordersByStatus).toEqual({ paid: 5, pending: 2 });
    expect(stats.recentOrders).toEqual([{ id: 'o1', buyer_name: 'Douglas' }]);
  });

  it('returns zero totals when there are no orders', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ count: 0, revenue_cents: 0 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const stats = await getDashboardStats();

    expect(stats.paidOrders).toBe(0);
    expect(stats.totalRevenueCents).toBe(0);
    expect(stats.ordersByStatus).toEqual({});
    expect(stats.recentOrders).toEqual([]);
  });
});
