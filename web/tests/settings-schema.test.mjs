import { describe, expect, it } from 'vitest';
import { settingsUpdateSchema } from '../lib/schemas.js';

describe('settingsUpdateSchema', () => {
  it('accepts a partial update with just one field', () => {
    const parsed = settingsUpdateSchema.parse({ product_title: 'Novo título' });
    expect(parsed).toEqual({ product_title: 'Novo título' });
  });

  it('accepts an empty object (no fields changed)', () => {
    expect(settingsUpdateSchema.parse({})).toEqual({});
  });

  it('rejects an invalid product_access_url scheme', () => {
    expect(() => settingsUpdateSchema.parse({ product_access_url: 'javascript:alert(1)' })).toThrow();
  });

  it('coerces smtp_port to a number', () => {
    const parsed = settingsUpdateSchema.parse({ smtp_port: '587' });
    expect(parsed.smtp_port).toBe(587);
  });

  it('rejects an invalid email_from', () => {
    expect(() => settingsUpdateSchema.parse({ email_from: 'not-an-email' })).toThrow();
  });

  it('allows email_reply_to to be cleared to an empty string', () => {
    const parsed = settingsUpdateSchema.parse({ email_reply_to: '' });
    expect(parsed.email_reply_to).toBe('');
  });
});
