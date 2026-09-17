import { NextResponse } from 'next/server';
import { getClientIp } from '../../../../lib/http.js';
import { resolveSession } from '../../../../lib/auth/guard.js';
import { logAdminAction } from '../../../../lib/auth/accessLog.js';
import { ADMIN_COOKIE } from '../../../../lib/auth/cookies.js';
import { settingsUpdateSchema } from '../../../../lib/schemas.js';
import { getAllSettingsForAdmin, setSetting, isMaskedSetting } from '../../../../lib/settings.js';

export async function GET(request) {
  const token = request.cookies.get(ADMIN_COOKIE)?.value || null;
  const session = await resolveSession(token, 'admin');
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  try {
    const settings = await getAllSettingsForAdmin();
    return NextResponse.json({ settings });
  } catch (error) {
    console.error('[api/admin/settings GET] failed:', error);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}

export async function PATCH(request) {
  const token = request.cookies.get(ADMIN_COOKIE)?.value || null;
  const session = await resolveSession(token, 'admin');
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  try {
    let raw;
    try { raw = await request.json(); } catch { raw = {}; }
    const data = settingsUpdateSchema.parse(raw);

    const changedKeys = Object.keys(data).filter((key) => {
      if (data[key] === undefined) return false;
      if (isMaskedSetting(key) && data[key] === '') return false;
      return true;
    });
    for (const key of changedKeys) {
      await setSetting(key, data[key]);
    }
    await logAdminAction(session.subject_id, 'update_settings', changedKeys.join(','), getClientIp(request));

    const settings = await getAllSettingsForAdmin();
    return NextResponse.json({ settings });
  } catch (error) {
    if (error.name === 'ZodError') {
      return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
    }
    console.error('[api/admin/settings PATCH] failed:', error);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}
