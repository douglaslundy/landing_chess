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

describe('grouped settings getters (DB-first, env fallback)', () => {
  beforeEach(() => {
    process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
    process.env.SETTINGS_ENCRYPTION_KEY = VALID_KEY;
    resetPoolForTests();
    queryMock.mockReset();
  });

  afterEach(() => {
    delete process.env.DATABASE_URL;
    delete process.env.SETTINGS_ENCRYPTION_KEY;
    delete process.env.MERCADOPAGO_PUBLIC_KEY;
    delete process.env.MERCADOPAGO_ACCESS_TOKEN;
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_SECURE;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASSWORD;
    delete process.env.EMAIL_FROM;
    delete process.env.PRODUCT_ACCESS_URL;
  });

  it('getProductSettings reads all four fields from the DB', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ value: 'Xadrez Essencial', encrypted: false }] })
      .mockResolvedValueOnce({ rows: [{ value: 'Descrição', encrypted: false }] })
      .mockResolvedValueOnce({ rows: [{ value: '4990', encrypted: false }] })
      .mockResolvedValueOnce({ rows: [{ value: 'BRL', encrypted: false }] });

    const { getProductSettings } = await import('../lib/settings.js');
    const product = await getProductSettings();

    expect(product).toEqual({
      code: 'xadrez-essencial-pdf',
      title: 'Xadrez Essencial',
      description: 'Descrição',
      amountCents: 4990,
      currency: 'BRL'
    });
  });

  it('getMercadoPagoSettings falls back to env vars when the DB has no rows', async () => {
    process.env.MERCADOPAGO_PUBLIC_KEY = 'TEST-public';
    process.env.MERCADOPAGO_ACCESS_TOKEN = 'TEST-token';
    queryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const { getMercadoPagoSettings } = await import('../lib/settings.js');
    const mp = await getMercadoPagoSettings();

    expect(mp).toEqual({ publicKey: 'TEST-public', accessToken: 'TEST-token', webhookSecret: undefined });
  });

  it('getSmtpSettings falls back to env vars when the DB has no rows', async () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_PORT = '587';
    process.env.SMTP_SECURE = 'false';
    process.env.SMTP_USER = 'user@example.com';
    process.env.SMTP_PASSWORD = 'env-password';
    process.env.EMAIL_FROM = 'from@example.com';
    queryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const { getSmtpSettings } = await import('../lib/settings.js');
    const smtp = await getSmtpSettings();

    expect(smtp.host).toBe('smtp.example.com');
    expect(smtp.port).toBe(587);
    expect(smtp.secure).toBe(false);
    expect(smtp.password).toBe('env-password');
  });

  it('getProductAccessUrl falls back to env when the DB has no row', async () => {
    process.env.PRODUCT_ACCESS_URL = 'https://produto.example/acesso';
    queryMock.mockResolvedValueOnce({ rows: [] });

    const { getProductAccessUrl } = await import('../lib/settings.js');
    await expect(getProductAccessUrl()).resolves.toBe('https://produto.example/acesso');
  });
});
