import { Pool } from 'pg';

let pool;

function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
      max: 3
    });
  }
  return pool;
}

export async function checkDatabaseConnection() {
  const result = await getPool().query('SELECT 1 AS ok');
  return result.rows[0]?.ok === 1;
}

export function resetPoolForTests() {
  pool = undefined;
}
