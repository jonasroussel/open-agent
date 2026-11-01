import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

import type { SecretBox } from '../../application/ports/secret-box.ts';

const IV_BYTES = 12;
const TAG_BYTES = 16;

/** AES-256-GCM; the sealed text is base64 of IV, authentication tag and ciphertext. */
export class AesSecretBox implements SecretBox {
  readonly #key: Buffer;

  /** Any long random string: it is hashed into the 256-bit key. */
  constructor(secret: string) {
    this.#key = createHash('sha256').update(secret).digest();
  }

  seal(secret: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.#key, iv);
    const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
  }

  open(sealed: string): string {
    const bytes = Buffer.from(sealed, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', this.#key, bytes.subarray(0, IV_BYTES));
    decipher.setAuthTag(bytes.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
    return Buffer.concat([decipher.update(bytes.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString('utf8');
  }
}
