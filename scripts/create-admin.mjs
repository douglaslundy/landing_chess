import { randomUUID } from 'node:crypto';
import { hashPassword } from '../web/lib/auth/password.js';

function sqlEscape(value) {
  return value.replace(/'/g, "''");
}

export function buildInsertSql(email, passwordHash) {
  const id = randomUUID();
  const escapedEmail = sqlEscape(email.trim().toLowerCase());
  const escapedHash = sqlEscape(passwordHash);
  return `insert into admin_users (id, email, password_hash) values ('${id}', '${escapedEmail}', '${escapedHash}') on conflict (email) do update set password_hash = excluded.password_hash;`;
}

async function main() {
  const [, , email, password] = process.argv;
  if (!email || !password) {
    console.error('uso: node scripts/create-admin.mjs <email> <senha>');
    process.exit(1);
  }
  const passwordHash = await hashPassword(password);
  console.log(buildInsertSql(email, passwordHash));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
