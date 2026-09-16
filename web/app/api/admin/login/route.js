import { NextResponse } from 'next/server';
import { query } from '../../../../lib/db.js';
import { getClientIp } from '../../../../lib/http.js';
import { rateLimit } from '../../../../lib/rate-limit.js';
import { adminLoginSchema } from '../../../../lib/schemas.js';
import { verifyPassword } from '../../../../lib/auth/password.js';
import { createSession } from '../../../../lib/auth/session.js';
import { setSessionCookie, ADMIN_COOKIE } from '../../../../lib/auth/cookies.js';
import { logAccess } from '../../../../lib/auth/accessLog.js';
import { SESSION_TTL_SECONDS } from '../../../../lib/constants.js';

export async function POST(request) {
  const ip = getClientIp(request);
  try {
    let raw;
    try { raw = await request.json(); } catch { raw = {}; }
    const { email, password } = adminLoginSchema.parse(raw);
    const normalizedEmail = email.toLowerCase();

    const allowed = await rateLimit({ key: `admin-login:${ip}:${normalizedEmail}`, limit: 5, windowSeconds: 900 });
    if (!allowed) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

    const result = await query('select id, password_hash from admin_users where email = $1', [normalizedEmail]);
    const admin = result.rows[0];
    const valid = admin ? await verifyPassword(password, admin.password_hash) : false;
    if (!valid) {
      await logAccess({ subjectType: 'admin', subjectId: null, event: 'login_failure', detail: 'invalid_credentials', ip });
      return NextResponse.json({ error: 'invalid_credentials' }, { status: 401 });
    }

    const { token } = await createSession('admin', admin.id, SESSION_TTL_SECONDS.admin);
    await logAccess({ subjectType: 'admin', subjectId: admin.id, event: 'login_success', ip });

    const response = NextResponse.json({ ok: true });
    return setSessionCookie(response, ADMIN_COOKIE, token, SESSION_TTL_SECONDS.admin);
  } catch (error) {
    if (error.name === 'ZodError') {
      return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
    }
    console.error('[api/admin/login POST] failed:', error);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}
