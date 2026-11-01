import { SIGN_IN_CODE_LENGTH } from '@open-agent/shared';

/** 256 random bits, safe in a URL and a cookie. */
export function randomToken(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
}

/** Uniform over every code: values past the last full range of 10^n are drawn again. */
export function randomCode(): string {
  const range = 10 ** SIGN_IN_CODE_LENGTH;
  const limit = Math.floor(2 ** 32 / range) * range;
  const value = new Uint32Array(1);
  do crypto.getRandomValues(value);
  while (value[0]! >= limit);
  return String(value[0]! % range).padStart(SIGN_IN_CODE_LENGTH, '0');
}

/** Only hashes are stored: a copy of the database alone cannot be used to sign in. */
export function sha256(secret: string): string {
  return new Bun.CryptoHasher('sha256').update(secret).digest('hex');
}
