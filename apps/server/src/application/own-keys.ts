import type { UserRepository } from '../domain/user-repository.ts';
import type { User } from '../domain/user.ts';
import type { Clock } from './ports/clock.ts';
import type { KeyChecker } from './ports/model-catalog.ts';
import type { SecretBox } from './ports/secret-box.ts';

/** OpenRouter keys are about 70 characters; anything far longer is a paste gone wrong. */
const MAX_KEY_LENGTH = 200;
const HINT_CHARACTERS = 4;

export type OwnKeyView = { hint: string; addedAt: Date } | null;

export type SetOwnKeyResult =
  | { ok: true; key: OwnKeyView }
  | { ok: false; reason: 'invalid_request' | 'invalid_key' | 'key_check_failed' };

/** A user's own OpenRouter key: checked with OpenRouter, kept encrypted, shown back only by its last characters. */
export class OwnKeys {
  readonly #users: UserRepository;
  readonly #secrets: SecretBox;
  readonly #checker: KeyChecker;
  readonly #clock: Clock;

  constructor(users: UserRepository, secrets: SecretBox, checker: KeyChecker, clock: Clock) {
    this.#users = users;
    this.#secrets = secrets;
    this.#checker = checker;
    this.#clock = clock;
  }

  view(user: User): OwnKeyView {
    if (!user.ownKey) return null;
    return { hint: this.#secrets.open(user.ownKey.sealed).slice(-HINT_CHARACTERS), addedAt: user.ownKey.addedAt };
  }

  /** Replaces the previous one; its calls are paid by it from the next message on. */
  async set(user: User, raw: unknown): Promise<SetOwnKeyResult> {
    const key = typeof raw === 'string' ? raw.trim() : '';
    if (!key || key.length > MAX_KEY_LENGTH || /\s/.test(key)) return { ok: false, reason: 'invalid_request' };
    try {
      if (!(await this.#checker.accepts(key))) return { ok: false, reason: 'invalid_key' };
    } catch (error) {
      console.error('Key check failed:', error);
      return { ok: false, reason: 'key_check_failed' };
    }
    const ownKey = { sealed: this.#secrets.seal(key), addedAt: this.#clock.now() };
    await this.#users.setOwnKey(user.id, ownKey);
    return { ok: true, key: { hint: key.slice(-HINT_CHARACTERS), addedAt: ownKey.addedAt } };
  }

  async remove(user: User): Promise<void> {
    await this.#users.setOwnKey(user.id, null);
  }
}
