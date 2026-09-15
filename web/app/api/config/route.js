import { NextResponse } from 'next/server';
import { publicConfig } from '../../../lib/env.js';
import { PRODUCT } from '../../../lib/constants.js';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json({
      ...publicConfig(),
      product: {
        title: PRODUCT.title,
        amountCents: PRODUCT.amountCents,
        currency: PRODUCT.currency
      },
      polling: {
        initialMs: 4000,
        inactiveMs: 15000
      }
    });
  } catch (error) {
    console.error('[api/config] failed:', error);
    return NextResponse.json({ error: error.code || 'configuration_error' }, { status: 500 });
  }
}
