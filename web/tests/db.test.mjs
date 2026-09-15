import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();

vi.mock('pg', () => ({
  Pool: vi.fn().mockImplementation(function PoolMock() {
    return { query: queryMock };
  })
}));

const { checkDatabaseConnection, resetPoolForTests } = await import('../lib/db.js');

describe('checkDatabaseConnection', () => {
  beforeEach(() => {
    process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
    resetPoolForTests();
    queryMock.mockReset();
  });

  afterEach(() => {
    delete process.env.DATABASE_URL;
  });

  it('returns true when the database responds to SELECT 1', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ ok: 1 }] });
    await expect(checkDatabaseConnection()).resolves.toBe(true);
  });

  it('propagates the error when the database is unreachable', async () => {
    queryMock.mockRejectedValueOnce(new Error('connection refused'));
    await expect(checkDatabaseConnection()).rejects.toThrow('connection refused');
  });
});
