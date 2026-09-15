import { NextResponse } from 'next/server';
import { required } from '../../../../lib/env.js';
import { runReconciliation } from '../../../../lib/reconcile.js';

async function handleReconcile(request) {
  const auth = request.headers.get('authorization') || '';
  if (auth !== `Bearer ${required('CRON_SECRET')}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const result = await runReconciliation();
    return NextResponse.json(result);
  } catch (error) {
    console.error('[cron/reconcile] failed:', error);
    return NextResponse.json({ error: 'reconcile_error' }, { status: 500 });
  }
}

export async function GET(request) {
  return handleReconcile(request);
}

export async function POST(request) {
  return handleReconcile(request);
}
