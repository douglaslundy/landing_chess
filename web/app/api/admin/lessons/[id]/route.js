import { NextResponse } from 'next/server';
import { getClientIp } from '../../../../../lib/http.js';
import { resolveSession } from '../../../../../lib/auth/guard.js';
import { logAdminAction } from '../../../../../lib/auth/accessLog.js';
import { ADMIN_COOKIE } from '../../../../../lib/auth/cookies.js';
import { lessonSchema } from '../../../../../lib/schemas.js';
import { updateLesson, deleteLesson } from '../../../../../lib/lessons.js';

export async function PATCH(request, { params }) {
  const token = request.cookies.get(ADMIN_COOKIE)?.value || null;
  const session = await resolveSession(token, 'admin');
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  try {
    const { id } = await params;
    let raw;
    try { raw = await request.json(); } catch { raw = {}; }
    const data = lessonSchema.parse(raw);
    const lesson = await updateLesson(id, data);
    if (!lesson) return NextResponse.json({ error: 'lesson_not_found' }, { status: 404 });
    await logAdminAction(session.subject_id, 'update_lesson', id, getClientIp(request));
    return NextResponse.json({ lesson });
  } catch (error) {
    if (error.name === 'ZodError') {
      return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
    }
    console.error('[api/admin/lessons/[id] PATCH] failed:', error);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  const token = request.cookies.get(ADMIN_COOKIE)?.value || null;
  const session = await resolveSession(token, 'admin');
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  try {
    const { id } = await params;
    const deleted = await deleteLesson(id);
    if (!deleted) return NextResponse.json({ error: 'lesson_not_found' }, { status: 404 });
    await logAdminAction(session.subject_id, 'delete_lesson', id, getClientIp(request));
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[api/admin/lessons/[id] DELETE] failed:', error);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}
