export interface SessionStore {
  /** Returns the secret token to give to the device. Sessions expired at `now` are cleaned up. */
  create(userId: number, expiresAt: Date, now: Date): Promise<string>;
  /** The user of a valid, unexpired session. */
  findUserId(token: string, now: Date): Promise<number | null>;
  delete(token: string): Promise<void>;
  /** Signs the user out of every device. */
  deleteAllOf(userId: number): Promise<void>;
}
