/** Encrypts what must not sit in the database in clear: the users' own OpenRouter keys. */
export interface SecretBox {
  seal(secret: string): string;
  /** Throws when the sealed text was tampered with or sealed with another key. */
  open(sealed: string): string;
}
