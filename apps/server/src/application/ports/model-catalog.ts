import type { LanguageModel, ProviderMetadata } from 'ai';

/**
 * `fast`: everyday answers, thinking off. `reasoning`: answers that need thinking (math, planning, tricky code).
 * `background`: quick hidden calls (pre-analysis, titles), thinking off.
 */
export type ModelRole = 'fast' | 'reasoning' | 'background';

export type ModelChoice = {
  /** Already set up for its role (thinking, usage accounting). */
  model: LanguageModel;
  /** As billed, for the usage ledger. */
  modelId: string;
};

export interface ModelCatalog {
  /** Throws `ModelUnavailableError` when no provider is configured. */
  choose(role: ModelRole): ModelChoice;
  /** The billed cost of a call, from the provider's metadata; `null` when it did not say. */
  costOf(metadata: ProviderMetadata | undefined): number | null;
}

export class ModelUnavailableError extends Error {
  constructor() {
    super('No language model provider is configured (OPENROUTER_API_KEY).');
  }
}
