export const ADMIN_COOKIE = 'admin_session';
export const CLIENT_COOKIE = 'client_session';

function baseOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/'
  };
}

export function setSessionCookie(response, name, token, maxAgeSeconds) {
  response.cookies.set(name, token, { ...baseOptions(), maxAge: maxAgeSeconds });
  return response;
}

export function clearSessionCookie(response, name) {
  response.cookies.set(name, '', { ...baseOptions(), maxAge: 0 });
  return response;
}
