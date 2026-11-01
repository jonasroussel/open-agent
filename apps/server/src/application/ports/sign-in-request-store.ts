export type NewSignInRequest = { userId: number; expiresAt: Date; withCode: boolean; now: Date };

/** The secrets to email; only their hashes are stored. */
export type SignInSecrets = { token: string; code: string | null };

/** Every link and code works once, until it expires. */
export interface SignInRequestStore {
  /** Requests expired at `now` are cleaned up. */
  create(request: NewSignInRequest): Promise<SignInSecrets>;
  /** Marks the request used; its user, or `null` when the token is unknown, used or expired. */
  useToken(token: string, now: Date): Promise<number | null>;
  /** Marks the user's matching request used; `false` when no valid request of theirs has this code. */
  useCode(userId: number, code: string, now: Date): Promise<boolean>;
}
