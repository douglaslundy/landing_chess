import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();

vi.mock('pg', () => ({
  Pool: vi.fn().mockImplementation(function PoolMock() {
    return { query: queryMock };
  })
}));

const { resetPoolForTests } = await import('../lib/db.js');
const { createMagicLink, consumeMagicLink, cleanupExpiredMagicLinks } = await import('../lib/auth/magicLink.js');

describe('magic links', () => {
  beforeEach(() => {
    process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
    resetPoolForTests();
    queryMock.mockReset();
  });

  afterEach(() => {
    delete process.env.DATABASE_URL;
  });

  it('creates a magic link with a lowercased email and returns the token', async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const token = await createMagicLink('Client@Example.com', 1800);
    expect(typeof token).toBe('string');
    expect(queryMock).toHaveBeenCalledWith(expect.stringContaining('insert into magic_links'), [token, 'client@example.com', 1800]);
  });

  it('consumes a valid, unused, unexpired token and returns the email', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ email: 'client@example.com' }] });
    await expect(consumeMagicLink('tok')).resolves.toEqual({ email: 'client@example.com' });
  });

  it('returns null when the token is expired, already used, or unknown', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    await expect(consumeMagicLink('bad-tok')).resolves.toBeNull();
  });

  it('returns null immediately without querying when token is falsy', async () => {
    await expect(consumeMagicLink(null)).resolves.toBeNull();
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('cleans up expired or used magic links and returns the count removed', async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 4 });
    await expect(cleanupExpiredMagicLinks()).resolves.toBe(4);
  });
});
