import { NextResponse } from 'next/server';
import { consumeMagicLink } from '../../../../../lib/auth/magicLink.js';
import { createSession } from '../../../../../lib/auth/session.js';
import { setSessionCookie, CLIENT_COOKIE } from '../../../../../lib/auth/cookies.js';
import { logAccess } from '../../../../../lib/auth/accessLog.js';
import { getClientIp } from '../../../../../lib/http.js';
import { SESSION_TTL_SECONDS } from '../../../../../lib/constants.js';

export async function GET(request) {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  const ip = getClientIp(request);

  const consumed = await consumeMagicLink(token);
  if (!consumed) {
    return NextResponse.redirect(new URL('/cliente/entrar?erro=link_invalido', request.url));
  }

  const { token: sessionToken } = await createSession('client', consumed.email, SESSION_TTL_SECONDS.client);
  await logAccess({ subjectType: 'client', subjectId: consumed.email, event: 'login_success', detail: 'magic_link', ip });

  const response = NextResponse.redirect(new URL('/cliente', request.url));
  return setSessionCookie(response, CLIENT_COOKIE, sessionToken, SESSION_TTL_SECONDS.client);
}
