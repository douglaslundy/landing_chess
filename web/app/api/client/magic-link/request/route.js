import { NextResponse } from 'next/server';
import { query } from '../../../../../lib/db.js';
import { getClientIp } from '../../../../../lib/http.js';
import { rateLimit } from '../../../../../lib/rate-limit.js';
import { clientMagicLinkRequestSchema } from '../../../../../lib/schemas.js';
import { createMagicLink } from '../../../../../lib/auth/magicLink.js';
import { sendMagicLinkEmail } from '../../../../../lib/email.js';
import { MAGIC_LINK_TTL_SECONDS } from '../../../../../lib/constants.js';

const GENERIC_RESPONSE = { message: 'Se este e-mail tiver uma compra confirmada, enviamos um link de acesso.' };

export async function POST(request) {
  try {
    const ip = getClientIp(request);
    let raw;
    try { raw = await request.json(); } catch { raw = {}; }
    const { email } = clientMagicLinkRequestSchema.parse(raw);
    const normalizedEmail = email.toLowerCase();

    const okShort = await rateLimit({ key: `magiclink:short:${normalizedEmail}`, limit: 1, windowSeconds: 120 });
    if (!okShort) {
      return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
    }

    const okDay = await rateLimit({ key: `magiclink:day:${ip}:${normalizedEmail}`, limit: 5, windowSeconds: 86400 });
    if (!okDay) {
      return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
    }

    const result = await query(
      `select 1 from orders where lower(buyer_email) = $1 and status = 'paid' limit 1`,
      [normalizedEmail]
    );
    if (result.rowCount) {
      const token = await createMagicLink(normalizedEmail, MAGIC_LINK_TTL_SECONDS);
      sendMagicLinkEmail(normalizedEmail, token).catch((error) => {
        console.error('[api/client/magic-link/request] send failed:', error);
      });
    }
    return NextResponse.json(GENERIC_RESPONSE);
  } catch (error) {
    if (error.name === 'ZodError') {
      return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
    }
    console.error('[api/client/magic-link/request POST] failed:', error);
    return NextResponse.json(GENERIC_RESPONSE);
  }
}
