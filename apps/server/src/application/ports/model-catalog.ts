import type { ModelCapability, ModelRole } from '@open-agent/shared';
import type { LanguageModel, ProviderMetadata } from 'ai';

export type { ModelRole };

/** How much a language model thinks before it answers: OpenRouter's reasoning effort, `off` when it does not. */
export type Thinking = 'off' | 'low' | 'medium';

export type ModelChoice = {
  /** Already set up for its role (thinking, usage accounting). */
  model: LanguageModel;
  /** As billed, for the usage ledger. */
  modelId: string;
  /** Billed to the user's own OpenRouter key rather than the app's. */
  paidByUser: boolean;
  /** What the model reads and does, from the provider's list; empty when the list could not be reached. */
  capabilities: readonly ModelCapability[];
};

/** The provider: a model set up for a role. Which model each role uses is a setting (`Models`). */
export interface ModelCatalog {
  /**
   * `ownKey`: the user's own key, which then pays; `null`: the app's key. `thinking` is ignored for the image role.
   * Throws `ModelUnavailableError` when the app has no key and the user none either.
   */
  choose(
    role: ModelRole,
    modelId: string,
    ownKey: string | null,
    thinking: Thinking,
  ): Omit<ModelChoice, 'capabilities'>;
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
  /** USD per million tokens; `null` for both when it depends on the model a router picks. */
  inputPrice: number | null;
  outputPrice: number | null;
};

export interface ModelDirectory {
  /** Every model the provider offers. Throws when it cannot be reached. */
  list(): Promise<ModelInfo[]>;
}
