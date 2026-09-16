import { describe, expect, it } from 'vitest';
import {
  adminLoginSchema,
  clientLoginSchema,
  clientMagicLinkRequestSchema,
  clientSetPasswordSchema
} from '../lib/schemas.js';

describe('auth schemas', () => {
  it('requires a valid email and non-empty password for login', () => {
    expect(() => adminLoginSchema.parse({ email: 'not-an-email', password: 'x' })).toThrow();
    expect(() => adminLoginSchema.parse({ email: 'a@b.com', password: '' })).toThrow();
    expect(adminLoginSchema.parse({ email: 'A@B.com', password: 'secret' })).toEqual({ email: 'A@B.com', password: 'secret' });
  });

  it('clientLoginSchema has the same shape as adminLoginSchema', () => {
    expect(clientLoginSchema.parse({ email: 'a@b.com', password: 'secret' })).toEqual({ email: 'a@b.com', password: 'secret' });
  });

  it('magic link request only requires an email', () => {
    expect(clientMagicLinkRequestSchema.parse({ email: 'a@b.com' })).toEqual({ email: 'a@b.com' });
    expect(() => clientMagicLinkRequestSchema.parse({ email: 'nope' })).toThrow();
  });

  it('set-password requires at least 8 characters', () => {
    expect(() => clientSetPasswordSchema.parse({ password: '1234567' })).toThrow();
    expect(clientSetPasswordSchema.parse({ password: '12345678' })).toEqual({ password: '12345678' });
  });
});
