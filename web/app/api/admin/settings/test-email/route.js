import { NextResponse } from 'next/server';
import { getClientIp } from '../../../../../lib/http.js';
import { resolveSession } from '../../../../../lib/auth/guard.js';
import { logAdminAction } from '../../../../../lib/auth/accessLog.js';
import { ADMIN_COOKIE } from '../../../../../lib/auth/cookies.js';
import { testEmailSchema } from '../../../../../lib/schemas.js';
import { sendTestEmail } from '../../../../../lib/email.js';

export async function POST(request) {
  const token = request.cookies.get(ADMIN_COOKIE)?.value || null;
  const session = await resolveSession(token, 'admin');
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  try {
    let raw;
    try { raw = await request.json(); } catch { raw = {}; }
    const { to } = testEmailSchema.parse(raw);
    await sendTestEmail(to);
    await logAdminAction(session.subject_id, 'test_email', to, getClientIp(request));
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error.name === 'ZodError') {
      return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
    }
    console.error('[api/admin/settings/test-email POST] failed:', error);
    return NextResponse.json({ error: error.message || 'send_failed' }, { status: 500 });
  }
}
