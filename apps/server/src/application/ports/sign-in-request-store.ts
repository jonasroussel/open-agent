import type { Locale } from '@open-agent/shared';

/**
 * An emailed sign-in has a code and the language the form asked for, given to the user once they prove who they are;
 * an invitation has neither.
 */
export type NewSignInRequest = { userId: number; expiresAt: Date; now: Date } & (
  | { withCode: true; locale: Locale }
  | { withCode: false }
);

/** The secrets to email; only their hashes are stored. */
export type SignInSecrets = { token: string; code: string | null };

export type UsedSignInRequest = { userId: number; locale: Locale | null };

/** Codes typed against one request, the right one included: guessing one of a million codes stays hopeless. */
export const MAX_CODE_TRIES = 5;

/** Every link and code works once, until it expires. A user has one live code: the latest. */
export interface SignInRequestStore {
  /** Requests expired at `now` are cleaned up; a request with a code retires the user's earlier codes. */
  create(request: NewSignInRequest): Promise<SignInSecrets>;
  /** Marks the request used; `null` when the token is unknown, used or expired. */
  useToken(token: string, now: Date): Promise<UsedSignInRequest | null>;
  /**
   * Marks the user's live request used when the code matches; `null` otherwise. Each try counts, and after
   * `MAX_CODE_TRIES` the code is refused, even the right one.
   */
  useCode(userId: number, code: string, now: Date): Promise<UsedSignInRequest | null>;
}
