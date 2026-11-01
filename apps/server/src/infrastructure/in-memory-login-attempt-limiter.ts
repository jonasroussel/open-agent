import type { LoginAttemptLimiter } from '../application/ports/login-attempt-limiter.ts';

/**
 * Attempts kept in memory, per key, over a sliding window. Keys are "kind:value" ("email:ana@example.com");
 * each kind has its own limit. A server restart forgets the counts, which is acceptable for a private circle.
 */
export class InMemoryLoginAttemptLimiter implements LoginAttemptLimiter {
  readonly #failures = new Map<string, number[]>();
  readonly #windowMs: number;
  readonly #maxFailuresByKind: Record<string, number>;

  constructor(windowMs: number, maxFailuresByKind: Record<string, number>) {
    this.#windowMs = windowMs;
    this.#maxFailuresByKind = maxFailuresByKind;
  }

  isBlocked(keys: readonly string[], now: Date): boolean {
    return keys.some((key) => {
      const max = this.#maxFailuresByKind[key.split(':')[0]!];
      return max !== undefined && this.#recent(key, now).length >= max;
    });
  }

  recordFailure(keys: readonly string[], now: Date): void {
    for (const key of keys) this.#failures.set(key, [...this.#recent(key, now), now.getTime()]);
  }

  clear(key: string): void {
    this.#failures.delete(key);
  }

  #recent(key: string, now: Date): number[] {
    const since = now.getTime() - this.#windowMs;
    return (this.#failures.get(key) ?? []).filter((time) => time > since);
  }
}
