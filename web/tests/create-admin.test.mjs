import { describe, expect, it } from 'vitest';
import { buildInsertSql } from '../../scripts/create-admin.mjs';

describe('create-admin SQL builder', () => {
  it('builds an idempotent insert with the given email and password hash', () => {
    const sql = buildInsertSql('admin@example.com', 'saltHex:hashHex');
    expect(sql).toContain("insert into admin_users");
    expect(sql).toContain("'admin@example.com'");
    expect(sql).toContain("'saltHex:hashHex'");
    expect(sql).toContain('on conflict (email) do update set password_hash = excluded.password_hash');
  });

  it('escapes single quotes in the email to prevent breaking the SQL string', () => {
    const sql = buildInsertSql("o'brien@example.com", 'hash');
    expect(sql).toContain("o''brien@example.com");
  });
});
