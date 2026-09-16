import { afterEach, describe, expect, it } from 'vitest';
import { serverConfig } from '../lib/env.js';

describe('serverConfig', () => {
  afterEach(() => {
    delete process.env.APP_BASE_URL;
    delete process.env.MERCADOPAGO_ACCESS_TOKEN;
    delete process.env.DATABASE_URL;
    delete process.env.PRODUCT_ACCESS_URL;
    delete process.env.CRON_SECRET;
  });

  it('validates only the field actually accessed, not every field at once', () => {
    process.env.APP_BASE_URL = 'https://app.example/';

    const { appBaseUrl } = serverConfig();

    expect(appBaseUrl).toBe('https://app.example');
  });

  it('still throws when the accessed field is missing', () => {
    const cfg = serverConfig();

    expect(() => cfg.appBaseUrl).toThrow('Variavel de ambiente ausente: APP_BASE_URL');
  });

  it('throws for a different field independently when only that one is accessed', () => {
    process.env.APP_BASE_URL = 'https://app.example';

    const cfg = serverConfig();

    expect(() => cfg.mercadoPagoAccessToken).toThrow('Variavel de ambiente ausente: MERCADOPAGO_ACCESS_TOKEN');
  });
});
