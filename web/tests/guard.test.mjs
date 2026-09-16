import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/auth/session.js', () => ({
  getSession: vi.fn()
}));

const { getSession } = await import('../lib/auth/session.js');
const { resolveSession } = await import('../lib/auth/guard.js');

describe('resolveSession', () => {
  it('returns null when there is no token', async () => {
    await expect(resolveSession(null, 'admin')).resolves.toBeNull();
    expect(getSession).not.toHaveBeenCalled();
  });

  it('returns null when the session does not exist', async () => {
    getSession.mockResolvedValueOnce(null);
    await expect(resolveSession('tok', 'admin')).resolves.toBeNull();
  });

  it('returns null when the session belongs to a different subject type', async () => {
    getSession.mockResolvedValueOnce({ token: 'tok', subject_type: 'client', subject_id: 'a@b.com' });
    await expect(resolveSession('tok', 'admin')).resolves.toBeNull();
  });

  it('returns the session when token and subject type match', async () => {
    const session = { token: 'tok', subject_type: 'admin', subject_id: 'admin-1' };
    getSession.mockResolvedValueOnce(session);
    await expect(resolveSession('tok', 'admin')).resolves.toEqual(session);
  });
});
