import type { ModelCapability, ModelRole } from '@open-agent/shared';
import type { LanguageModel, ProviderMetadata } from 'ai';

export type { ModelRole };

export type ModelChoice = {
  /** Already set up for its role (thinking, usage accounting). */
  model: LanguageModel;
  /** As billed, for the usage ledger. */
  modelId: string;
  /** Billed to the user's own OpenRouter key rather than the app's. */
  paidByUser: boolean;
};

/** The provider: a model set up for a role. Which model each role uses is a setting (`Models`). */
export interface ModelCatalog {
  /**
   * `ownKey`: the user's own key, which then pays; `null`: the app's key. Throws `ModelUnavailableError` when the app
   * has no key and the user none either.
   */
  choose(role: ModelRole, modelId: string, ownKey: string | null): ModelChoice;
  /**
   * The billed cost of a call: from the provider's metadata, or from the reply's body when the call ended without
   * one (an answer that did not parse was billed all the same). `null` when the provider did not say.
   */
  costOf(metadata: ProviderMetadata | undefined, body?: unknown): number | null;
}

export interface KeyChecker {
  /** Whether the provider accepts the key. Throws when it cannot be reached. */
  accepts(apiKey: string): Promise<boolean>;
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
