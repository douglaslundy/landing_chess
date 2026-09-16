import { NextResponse } from 'next/server';
import { consumeMagicLink } from '../../../../../lib/auth/magicLink.js';
import { createSession } from '../../../../../lib/auth/session.js';
import { setSessionCookie, CLIENT_COOKIE } from '../../../../../lib/auth/cookies.js';
import { logAccess } from '../../../../../lib/auth/accessLog.js';
import { getClientIp } from '../../../../../lib/http.js';
import { serverConfig } from '../../../../../lib/env.js';
import { SESSION_TTL_SECONDS } from '../../../../../lib/constants.js';

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const token = url.searchParams.get('token');
    const ip = getClientIp(request);
    const { appBaseUrl } = serverConfig();

    const consumed = await consumeMagicLink(token);
    if (!consumed) {
      return NextResponse.redirect(`${appBaseUrl}/cliente/entrar?erro=link_invalido`);
    }

    const { token: sessionToken } = await createSession('client', consumed.email, SESSION_TTL_SECONDS.client);
    await logAccess({ subjectType: 'client', subjectId: consumed.email, event: 'login_success', detail: 'magic_link', ip });

    const response = NextResponse.redirect(`${appBaseUrl}/cliente`);
    return setSessionCookie(response, CLIENT_COOKIE, sessionToken, SESSION_TTL_SECONDS.client);
  } catch (error) {
    console.error('[api/client/magic-link/consume GET] failed:', error);
    try {
      const { appBaseUrl } = serverConfig();
      return NextResponse.redirect(`${appBaseUrl}/cliente/entrar?erro=link_invalido`);
    } catch {
      return NextResponse.json({ error: 'server_error' }, { status: 500 });
    }
  }
}
