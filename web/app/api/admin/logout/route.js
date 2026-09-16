import { NextResponse } from 'next/server';
import { getClientIp } from '../../../../lib/http.js';
import { destroySession } from '../../../../lib/auth/session.js';
import { resolveSession } from '../../../../lib/auth/guard.js';
import { ADMIN_COOKIE, clearSessionCookie } from '../../../../lib/auth/cookies.js';
import { logAccess } from '../../../../lib/auth/accessLog.js';

export async function POST(request) {
  const token = request.cookies.get(ADMIN_COOKIE)?.value || null;
  const session = await resolveSession(token, 'admin');
  if (session) {
    await destroySession(token);
    await logAccess({ subjectType: 'admin', subjectId: session.subject_id, event: 'logout', ip: getClientIp(request) });
  }
  const response = NextResponse.json({ ok: true });
  return clearSessionCookie(response, ADMIN_COOKIE);
}
