import { afterEach, describe, expect, it, vi } from 'vitest';
import { ADMIN_COOKIE, CLIENT_COOKIE, setSessionCookie, clearSessionCookie } from '../lib/auth/cookies.js';

function fakeResponse() {
  return { cookies: { set: vi.fn() } };
}

describe('session cookies', () => {
  afterEach(() => {
    delete process.env.NODE_ENV;
  });

  it('exports distinct cookie names for admin and client', () => {
    expect(ADMIN_COOKIE).toBe('admin_session');
    expect(CLIENT_COOKIE).toBe('client_session');
    expect(ADMIN_COOKIE).not.toBe(CLIENT_COOKIE);
  });

  it('sets an httpOnly cookie with the given token and maxAge', () => {
    const response = fakeResponse();
    setSessionCookie(response, ADMIN_COOKIE, 'tok123', 3600);
    expect(response.cookies.set).toHaveBeenCalledWith('admin_session', 'tok123', expect.objectContaining({
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 3600
    }));
  });

  it('marks the cookie secure in production', () => {
    process.env.NODE_ENV = 'production';
    const response = fakeResponse();
    setSessionCookie(response, ADMIN_COOKIE, 'tok123', 3600);
    expect(response.cookies.set).toHaveBeenCalledWith('admin_session', 'tok123', expect.objectContaining({ secure: true }));
  });

  it('does not mark the cookie secure outside production', () => {
    process.env.NODE_ENV = 'test';
    const response = fakeResponse();
    setSessionCookie(response, ADMIN_COOKIE, 'tok123', 3600);
    expect(response.cookies.set).toHaveBeenCalledWith('admin_session', 'tok123', expect.objectContaining({ secure: false }));
  });

  it('clears a cookie with an empty value and maxAge 0', () => {
    const response = fakeResponse();
    clearSessionCookie(response, CLIENT_COOKIE);
    expect(response.cookies.set).toHaveBeenCalledWith('client_session', '', expect.objectContaining({ maxAge: 0 }));
  });
});
