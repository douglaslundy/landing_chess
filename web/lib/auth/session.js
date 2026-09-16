import { randomBytes } from 'node:crypto';
import { query } from '../db.js';

const TOKEN_BYTES = 32;

export async function createSession(subjectType, subjectId, ttlSeconds) {
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  await query(
    `insert into sessions (token, subject_type, subject_id, expires_at)
     values ($1, $2, $3, now() + ($4::int * interval '1 second'))`,
    [token, subjectType, subjectId, ttlSeconds]
  );
  return { token };
}

export async function getSession(token) {
  if (!token) return null;
  const result = await query(
    `select token, subject_type, subject_id, expires_at
     from sessions
     where token = $1 and expires_at > now()`,
    [token]
  );
  return result.rows[0] || null;
}

export async function destroySession(token) {
  if (!token) return;
  await query('delete from sessions where token = $1', [token]);
}

export async function cleanupExpiredSessions() {
  const result = await query('delete from sessions where expires_at <= now()');
  return result.rowCount;
}
