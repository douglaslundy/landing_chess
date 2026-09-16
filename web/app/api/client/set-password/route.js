import { NextResponse } from 'next/server';
import { query } from '../../../../lib/db.js';
import { clientSetPasswordSchema } from '../../../../lib/schemas.js';
import { hashPassword } from '../../../../lib/auth/password.js';
import { resolveSession } from '../../../../lib/auth/guard.js';
import { CLIENT_COOKIE } from '../../../../lib/auth/cookies.js';

export async function POST(request) {
  try {
    const token = request.cookies.get(CLIENT_COOKIE)?.value || null;
    const session = await resolveSession(token, 'client');
    if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    let raw;
    try { raw = await request.json(); } catch { raw = {}; }
    const { password } = clientSetPasswordSchema.parse(raw);
    const passwordHash = await hashPassword(password);

    await query(
      `insert into client_credentials (email, password_hash)
       values ($1, $2)
       on conflict (email) do update set password_hash = excluded.password_hash`,
      [session.subject_id, passwordHash]
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error.name === 'ZodError') {
      return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
    }
    console.error('[api/client/set-password POST] failed:', error);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}
