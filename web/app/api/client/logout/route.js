import { NextResponse } from 'next/server';
import { getClientIp } from '../../../../lib/http.js';
import { destroySession } from '../../../../lib/auth/session.js';
import { resolveSession } from '../../../../lib/auth/guard.js';
import { CLIENT_COOKIE, clearSessionCookie } from '../../../../lib/auth/cookies.js';
import { logAccess } from '../../../../lib/auth/accessLog.js';

export async function POST(request) {
  const token = request.cookies.get(CLIENT_COOKIE)?.value || null;
  const session = await resolveSession(token, 'client');
  if (session) {
    await destroySession(token);
    await logAccess({ subjectType: 'client', subjectId: session.subject_id, event: 'logout', ip: getClientIp(request) });
  }
  const response = NextResponse.json({ ok: true });
  return clearSessionCookie(response, CLIENT_COOKIE);
}
