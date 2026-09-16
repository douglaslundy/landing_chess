import { NextResponse } from 'next/server';
import { required } from '../../../../lib/env.js';
import { runReconciliation } from '../../../../lib/reconcile.js';

async function handleReconcile(request) {
  try {
    const auth = request.headers.get('authorization') || '';
    if (auth !== `Bearer ${required('CRON_SECRET')}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const result = await runReconciliation();
    const failedEmails = result.emails.filter((email) => email.status === 'failed');
    if (failedEmails.length) {
      console.error('[cron/reconcile] email delivery failures:', failedEmails);
    }
    return NextResponse.json({
      reconciled: result.reconciled,
      emails: result.emails.map(({ id, status }) => ({ id, status })),
      sessionsCleaned: result.sessionsCleaned,
      magicLinksCleaned: result.magicLinksCleaned
    });
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
