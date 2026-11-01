import type { ModelCapability, ModelRole } from '@open-agent/shared';
import type { LanguageModel, ProviderMetadata } from 'ai';

export type { ModelRole };

export type ModelChoice = {
  /** Already set up for its role (thinking, usage accounting). */
  model: LanguageModel;
  /** As billed, for the usage ledger. */
  modelId: string;
};

/** The provider: a model set up for a role. Which model each role uses is a setting (`Models`). */
export interface ModelCatalog {
  /** Throws `ModelUnavailableError` when no provider is configured. */
  choose(role: ModelRole, modelId: string): ModelChoice;
  /** The billed cost of a call, from the provider's metadata; `null` when it did not say. */
  costOf(metadata: ProviderMetadata | undefined): number | null;
}

export class ModelUnavailableError extends Error {
  constructor() {
    super('No language model provider is configured (OPENROUTER_API_KEY).');
  }
}

/** A model the provider offers, with what the admin page needs to pick one. */
export type ModelInfo = {
  id: string;
  name: string;
  capabilities: ModelCapability[];
  /** USD per million tokens. */
  inputPrice: number;
  outputPrice: number;
};

export interface ModelDirectory {
  /** Every model the provider offers. Throws when it cannot be reached. */
  list(): Promise<ModelInfo[]>;
}
