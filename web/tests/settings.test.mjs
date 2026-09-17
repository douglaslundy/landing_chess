import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();

vi.mock('pg', () => ({
  Pool: vi.fn().mockImplementation(function PoolMock() {
    return { query: queryMock };
  })
}));

const VALID_KEY = Buffer.alloc(32, 7).toString('base64');

const { resetPoolForTests } = await import('../lib/db.js');
const { encryptValue } = await import('../lib/settingsCrypto.js');
const { getSetting, setSetting, getAllSettingsForAdmin, isEncryptedSetting } = await import('../lib/settings.js');

describe('settings store', () => {
  beforeEach(() => {
    process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
    process.env.SETTINGS_ENCRYPTION_KEY = VALID_KEY;
    resetPoolForTests();
    queryMock.mockReset();
  });

  afterEach(() => {
    delete process.env.DATABASE_URL;
    delete process.env.SETTINGS_ENCRYPTION_KEY;
  });

  it('returns null when a setting has no row', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    await expect(getSetting('product_title')).resolves.toBeNull();
  });

  it('returns the plain value for a non-encrypted setting', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ value: 'Xadrez Essencial', encrypted: false }] });
    await expect(getSetting('product_title')).resolves.toBe('Xadrez Essencial');
  });

  it('decrypts the value for an encrypted setting', async () => {
    const stored = encryptValue('secret-token');
    queryMock.mockResolvedValueOnce({ rows: [{ value: stored, encrypted: true }] });
    await expect(getSetting('mercadopago_access_token')).resolves.toBe('secret-token');
  });

  it('encrypts a value before storing it when the key is marked encrypted', async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    await setSetting('smtp_password', 'my-password');
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toContain('insert into settings');
    expect(params[0]).toBe('smtp_password');
    expect(params[1]).not.toBe('my-password');
    expect(params[2]).toBe(true);
  });

  it('stores a plain value as-is when the key is not encrypted', async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    await setSetting('product_title', 'Novo título');
    const [, params] = queryMock.mock.calls[0];
    expect(params).toEqual(['product_title', 'Novo título', false]);
  });

  it('rejects an unknown setting key', async () => {
    await expect(setSetting('not_a_real_key', 'x')).rejects.toThrow();
  });

  it('reports whether a key is defined as encrypted', () => {
    expect(isEncryptedSetting('smtp_password')).toBe(true);
    expect(isEncryptedSetting('product_title')).toBe(false);
  });

  it('getAllSettingsForAdmin masks encrypted fields as configured booleans', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        { key: 'product_title', value: 'Xadrez Essencial', encrypted: false },
        { key: 'mercadopago_access_token', value: 'iv:tag:data', encrypted: true }
      ]
    });
    const settings = await getAllSettingsForAdmin();
    expect(settings.product_title).toBe('Xadrez Essencial');
    expect(settings.mercadopago_access_token).toEqual({ configured: true });
    expect(settings.mercadopago_webhook_secret).toEqual({ configured: false });
  });
});
