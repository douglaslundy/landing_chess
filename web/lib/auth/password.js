import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;
export const DUMMY_PASSWORD_HASH = `${'00'.repeat(16)}:${'00'.repeat(64)}`;

export async function hashPassword(plain) {
  const salt = randomBytes(16);
  const derivedKey = await scrypt(plain, salt, KEY_LENGTH);
  return `${salt.toString('hex')}:${derivedKey.toString('hex')}`;
}

export async function verifyPassword(plain, stored) {
  const [saltHex, keyHex] = String(stored).split(':');
  if (!saltHex || !keyHex) return false;
  const salt = Buffer.from(saltHex, 'hex');
  const storedKey = Buffer.from(keyHex, 'hex');
  if (storedKey.length !== KEY_LENGTH) return false;
  const derivedKey = await scrypt(plain, salt, KEY_LENGTH);
  return timingSafeEqual(derivedKey, storedKey);
}
