import type { LanguageModelUsage, ProviderMetadata } from 'ai';

import type { UsageLedger, UsagePurpose } from '../domain/usage.ts';
import type { User } from '../domain/user.ts';
import type { Clock } from './ports/clock.ts';
import type { ModelCatalog, ModelChoice } from './ports/model-catalog.ts';

/** Every paid call of a user goes to the ledger with its billed cost: the quota will count them all. */
export class UsageRecorder {
  readonly #ledger: UsageLedger;
  readonly #models: ModelCatalog;
  readonly #clock: Clock;

  constructor(ledger: UsageLedger, models: ModelCatalog, clock: Clock) {
    this.#ledger = ledger;
    this.#models = models;
    this.#clock = clock;
  }

  async record(
    user: User,
    conversationId: string,
    purpose: UsagePurpose,
    choice: ModelChoice,
    usage: LanguageModelUsage,
    metadata: ProviderMetadata | undefined,
  ): Promise<void> {
    await this.#ledger.record({
      userId: user.id,
      conversationId,
      purpose,
      model: choice.modelId,
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      reasoningTokens: usage.outputTokenDetails.reasoningTokens ?? 0,
      costUsd: this.#models.costOf(metadata),
      paidByUser: choice.paidByUser,
      at: this.#clock.now(),
    });
  }

  /** Both search services are used within their free plans: a search costs nothing, but is counted. */
  async recordSearch(user: User, conversationId: string, provider: string): Promise<void> {
    await this.#ledger.record({
      userId: user.id,
      conversationId,
      purpose: 'web_search',
      model: provider,
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      costUsd: 0,
      paidByUser: false,
      at: this.#clock.now(),
    });
  }
}
