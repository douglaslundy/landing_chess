import { NextResponse } from 'next/server';
import { checkDatabaseConnection } from '../../../lib/db.js';

export async function GET() {
  try {
    await checkDatabaseConnection();
    return NextResponse.json({ ok: true, db: 'connected' });
  } catch (error) {
    return NextResponse.json(
      { ok: false, db: 'error', message: error.message },
      { status: 503 }
    );
  }
}
