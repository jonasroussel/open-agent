import { MAX_MONTHLY_QUOTA_USD } from '@open-agent/shared';

import { monthAround, quotaLimit, type Quota } from '../domain/quota.ts';
import type { UsageLedger } from '../domain/usage.ts';
import type { UserRepository } from '../domain/user-repository.ts';
import type { User } from '../domain/user.ts';
import type { Clock } from './ports/clock.ts';

export type SetQuotaResult = { ok: true; user: User } | { ok: false; reason: 'not_found' | 'invalid_request' };

/** What each user may spend per calendar month; the chat stops answering a user who spent it all. */
export class Quotas {
  readonly #ledger: UsageLedger;
  readonly #users: UserRepository;
  readonly #clock: Clock;
  readonly #defaultUsd: number;

  constructor(ledger: UsageLedger, users: UserRepository, clock: Clock, defaultUsd: number) {
    this.#ledger = ledger;
    this.#users = users;
    this.#clock = clock;
    this.#defaultUsd = defaultUsd;
  }

  async of(user: User): Promise<Quota> {
    const month = monthAround(this.#clock.now());
    return {
      limitUsd: quotaLimit(user, this.#defaultUsd),
      usedUsd: await this.#ledger.spentSince(user.id, month.start),
      resetsAt: month.end,
      ownKey: user.ownKey !== null,
    };
  }

  /** For the admin page: one query for everyone. */
  async ofEveryone(users: readonly User[]): Promise<Map<number, Quota>> {
    const month = monthAround(this.#clock.now());
    const spent = await this.#ledger.spentByUserSince(month.start);
    return new Map(
      users.map((user) => [
        user.id,
        {
          limitUsd: quotaLimit(user, this.#defaultUsd),
          usedUsd: spent.get(user.id) ?? 0,
          resetsAt: month.end,
          ownKey: user.ownKey !== null,
        },
      ]),
    );
  }

  /** Takes effect at once, for this month too. An admin's limit is kept for the day they are no longer admin. */
  async setLimit(userId: number, usd: unknown): Promise<SetQuotaResult> {
    if (typeof usd !== 'number' || !Number.isFinite(usd) || usd < 0 || usd > MAX_MONTHLY_QUOTA_USD) {
      return { ok: false, reason: 'invalid_request' };
    }
    const user = await this.#users.findById(userId);
    if (!user) return { ok: false, reason: 'not_found' };
    await this.#users.setMonthlyQuota(user.id, usd);
    return { ok: true, user: { ...user, monthlyQuotaUsd: usd } };
  }
}
