import { NextResponse } from 'next/server';
import { checkDatabaseConnection } from '../../../lib/db.js';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await checkDatabaseConnection();
    return NextResponse.json({ ok: true, db: 'connected' });
  } catch (error) {
    console.error('[health] database check failed:', error);
    return NextResponse.json({ ok: false, db: 'error' }, { status: 503 });
  }
}
