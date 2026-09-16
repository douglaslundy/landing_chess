import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();

vi.mock('pg', () => ({
  Pool: vi.fn().mockImplementation(function PoolMock() {
    return { query: queryMock };
  })
}));

const { resetPoolForTests } = await import('../lib/db.js');
const { logAccess, logAdminAction } = await import('../lib/auth/accessLog.js');

describe('access log', () => {
  beforeEach(() => {
    process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
    resetPoolForTests();
    queryMock.mockReset();
    queryMock.mockResolvedValue({ rows: [], rowCount: 1 });
  });

  afterEach(() => {
    delete process.env.DATABASE_URL;
  });

  it('logs a login success event with subject and ip', async () => {
    await logAccess({ subjectType: 'admin', subjectId: 'admin-1', event: 'login_success', ip: '1.2.3.4' });
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining('insert into access_log'),
      expect.arrayContaining(['admin', 'admin-1', 'login_success', null, '1.2.3.4'])
    );
  });

  it('logs a login failure with a null subject id', async () => {
    await logAccess({ subjectType: 'client', subjectId: null, event: 'login_failure', detail: 'invalid_credentials', ip: '1.2.3.4' });
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining('insert into access_log'),
      expect.arrayContaining(['client', null, 'login_failure', 'invalid_credentials', '1.2.3.4'])
    );
  });

  it('logAdminAction wraps logAccess with an admin_action event', async () => {
    await logAdminAction('admin-1', 'update_lesson', 'lesson-42', '1.2.3.4');
    const [, params] = queryMock.mock.calls[0];
    expect(params).toEqual(expect.arrayContaining(['admin', 'admin-1', 'admin_action', 'update_lesson: lesson-42', '1.2.3.4']));
  });
});
