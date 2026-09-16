import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();

vi.mock('pg', () => ({
  Pool: vi.fn().mockImplementation(function PoolMock() {
    return { query: queryMock };
  })
}));

const { resetPoolForTests } = await import('../lib/db.js');
const { createSession, getSession, destroySession, cleanupExpiredSessions } = await import('../lib/auth/session.js');

describe('session store', () => {
  beforeEach(() => {
    process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
    resetPoolForTests();
    queryMock.mockReset();
  });

  afterEach(() => {
    delete process.env.DATABASE_URL;
  });

  it('creates a session and returns an opaque token', async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const { token } = await createSession('admin', 'admin-id', 3600);
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(20);
    expect(queryMock).toHaveBeenCalledWith(expect.stringContaining('insert into sessions'), [token, 'admin', 'admin-id', 3600]);
  });

  it('returns the session row when found and not expired', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ token: 'abc', subject_type: 'client', subject_id: 'a@b.com' }] });
    const session = await getSession('abc');
    expect(session).toEqual({ token: 'abc', subject_type: 'client', subject_id: 'a@b.com' });
  });

  it('returns null when no matching session exists', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    await expect(getSession('missing')).resolves.toBeNull();
  });

  it('returns null immediately without querying when token is falsy', async () => {
    await expect(getSession(null)).resolves.toBeNull();
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('destroys a session by token', async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 1 });
    await destroySession('abc');
    expect(queryMock).toHaveBeenCalledWith('delete from sessions where token = $1', ['abc']);
  });

  it('cleans up expired sessions and returns the count removed', async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 3 });
    await expect(cleanupExpiredSessions()).resolves.toBe(3);
  });
});
