import { randomBytes } from 'node:crypto';
import { query } from '../db.js';

const TOKEN_BYTES = 32;

export async function createMagicLink(email, ttlSeconds) {
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  const normalizedEmail = email.trim().toLowerCase();
  await query(
    `insert into magic_links (token, email, expires_at)
     values ($1, $2, now() + ($3::int * interval '1 second'))`,
    [token, normalizedEmail, ttlSeconds]
  );
  return token;
}

export async function consumeMagicLink(token) {
  if (!token) return null;
  const result = await query(
    `update magic_links
     set used_at = now()
     where token = $1
       and used_at is null
       and expires_at > now()
     returning email`,
    [token]
  );
  return result.rows[0] || null;
}

export async function cleanupExpiredMagicLinks() {
  const result = await query(
    'delete from magic_links where expires_at <= now() or used_at is not null',
    []
  );
  return result.rowCount;
}
