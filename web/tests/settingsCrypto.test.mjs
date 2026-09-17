import { afterEach, describe, expect, it } from 'vitest';
import { encryptValue, decryptValue } from '../lib/settingsCrypto.js';

const VALID_KEY = Buffer.alloc(32, 7).toString('base64');

describe('settingsCrypto', () => {
  afterEach(() => {
    delete process.env.SETTINGS_ENCRYPTION_KEY;
  });

  it('round-trips a value through encrypt/decrypt', () => {
    process.env.SETTINGS_ENCRYPTION_KEY = VALID_KEY;
    const encrypted = encryptValue('super-secret-token');
    expect(encrypted).not.toContain('super-secret-token');
    expect(decryptValue(encrypted)).toBe('super-secret-token');
  });

  it('produces a different ciphertext each time (random iv)', () => {
    process.env.SETTINGS_ENCRYPTION_KEY = VALID_KEY;
    const a = encryptValue('same value');
    const b = encryptValue('same value');
    expect(a).not.toBe(b);
  });

  it('throws when the encryption key is missing', () => {
    expect(() => encryptValue('x')).toThrow();
  });

  it('throws when the encryption key is not 32 bytes', () => {
    process.env.SETTINGS_ENCRYPTION_KEY = Buffer.alloc(16, 1).toString('base64');
    expect(() => encryptValue('x')).toThrow('32 bytes');
  });
});
