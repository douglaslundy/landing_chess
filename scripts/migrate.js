const fs = require('fs');
const path = require('path');
const { query, withTransaction } = require('../api/_lib/db');

async function main() {
  await query(`
    create table if not exists schema_migrations (
      filename text primary key,
      applied_at timestamptz not null default now()
    )
  `);
  const dir = path.join(__dirname, '..', 'migrations');
  const files = fs.readdirSync(dir).filter((file) => file.endsWith('.sql')).sort();
  for (const file of files) {
    const applied = await query('select 1 from schema_migrations where filename = $1', [file]);
    if (applied.rowCount) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    try {
      await withTransaction(async (client) => {
        await client.query(sql);
        await client.query('insert into schema_migrations (filename) values ($1)', [file]);
      });
      console.log(`applied ${file}`);
    } catch (error) {
      throw error;
    }
  }
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
