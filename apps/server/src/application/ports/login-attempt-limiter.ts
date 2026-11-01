/** Counts attempts per key (an email address, a network address) over a sliding window. */
export interface LoginAttemptLimiter {
  isBlocked(keys: readonly string[], now: Date): boolean;
  recordFailure(keys: readonly string[], now: Date): void;
  clear(key: string): void;
}
