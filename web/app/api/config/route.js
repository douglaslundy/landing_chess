import { NextResponse } from 'next/server';
import { getMercadoPagoSettings, getProductSettings } from '../../../lib/settings.js';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const [mercadoPago, product] = await Promise.all([
      getMercadoPagoSettings(),
      getProductSettings()
    ]);
    return NextResponse.json({
      mercadoPagoPublicKey: mercadoPago.publicKey,
      product: {
        title: product.title,
        amountCents: product.amountCents,
        currency: product.currency
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
