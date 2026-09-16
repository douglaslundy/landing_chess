import { NextResponse } from 'next/server';
import { query } from '../../../../lib/db.js';
import { getClientIp } from '../../../../lib/http.js';
import { rateLimit } from '../../../../lib/rate-limit.js';
import { clientLoginSchema } from '../../../../lib/schemas.js';
import { verifyPassword } from '../../../../lib/auth/password.js';
import { createSession } from '../../../../lib/auth/session.js';
import { setSessionCookie, CLIENT_COOKIE } from '../../../../lib/auth/cookies.js';
import { logAccess } from '../../../../lib/auth/accessLog.js';
import { SESSION_TTL_SECONDS } from '../../../../lib/constants.js';

export async function POST(request) {
  const ip = getClientIp(request);
  try {
    let raw;
    try { raw = await request.json(); } catch { raw = {}; }
    const { email, password } = clientLoginSchema.parse(raw);
    const normalizedEmail = email.toLowerCase();

    const allowed = await rateLimit({ key: `client-login:${ip}:${normalizedEmail}`, limit: 5, windowSeconds: 900 });
    if (!allowed) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

    const result = await query('select password_hash from client_credentials where email = $1', [normalizedEmail]);
    const credentials = result.rows[0];
    const valid = credentials ? await verifyPassword(password, credentials.password_hash) : false;
    if (!valid) {
      await logAccess({ subjectType: 'client', subjectId: null, event: 'login_failure', detail: 'invalid_credentials', ip });
      return NextResponse.json({ error: 'invalid_credentials' }, { status: 401 });
    }

    const { token } = await createSession('client', normalizedEmail, SESSION_TTL_SECONDS.client);
    await logAccess({ subjectType: 'client', subjectId: normalizedEmail, event: 'login_success', ip });

    const response = NextResponse.json({ ok: true });
    return setSessionCookie(response, CLIENT_COOKIE, token, SESSION_TTL_SECONDS.client);
  } catch (error) {
    if (error.name === 'ZodError') {
      return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
    }
    console.error('[api/client/login POST] failed:', error);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}
