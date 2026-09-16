import { NextResponse } from 'next/server';
import { getClientIp } from '../../../../lib/http.js';
import { resolveSession } from '../../../../lib/auth/guard.js';
import { logAdminAction } from '../../../../lib/auth/accessLog.js';
import { ADMIN_COOKIE } from '../../../../lib/auth/cookies.js';
import { lessonSchema } from '../../../../lib/schemas.js';
import { listLessons, createLesson } from '../../../../lib/lessons.js';

export async function GET(request) {
  const token = request.cookies.get(ADMIN_COOKIE)?.value || null;
  const session = await resolveSession(token, 'admin');
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  try {
    const lessons = await listLessons();
    return NextResponse.json({ lessons });
  } catch (error) {
    console.error('[api/admin/lessons GET] failed:', error);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}

export async function POST(request) {
  const token = request.cookies.get(ADMIN_COOKIE)?.value || null;
  const session = await resolveSession(token, 'admin');
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  try {
    let raw;
    try { raw = await request.json(); } catch { raw = {}; }
    const data = lessonSchema.parse(raw);
    const lesson = await createLesson(data);
    await logAdminAction(session.subject_id, 'create_lesson', lesson.id, getClientIp(request));
    return NextResponse.json({ lesson }, { status: 201 });
  } catch (error) {
    if (error.name === 'ZodError') {
      return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
    }
    console.error('[api/admin/lessons POST] failed:', error);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}
