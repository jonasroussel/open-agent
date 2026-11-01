import { createOpenRouter, type OpenRouterProvider } from '@openrouter/ai-sdk-provider';
import type { ProviderMetadata } from 'ai';

import {
  ModelUnavailableError,
  type KeyChecker,
  type ModelCatalog,
  type ModelChoice,
  type ModelRole,
} from '../../application/ports/model-catalog.ts';

/**
 * Thinking per role, tested on deepseek-v4.1-flash-1017 (2026-11-01): off, a title takes about 0.5 s with 0 reasoning
 * tokens; `medium` solved a train-crossing problem in 3.4 s for 0.0007 $, as well as `high` (5.8 s).
 */
const REASONING: Record<ModelRole, { enabled: boolean; effort: 'none' | 'medium' }> = {
  fast: { enabled: false, effort: 'none' },
  reasoning: { enabled: true, effort: 'medium' },
  background: { enabled: false, effort: 'none' },
};

function provider(apiKey: string): OpenRouterProvider {
  // `strict` sends `stream_options.include_usage`: the cost then arrives at the end of a streamed answer too.
  return createOpenRouter({ apiKey, compatibility: 'strict', appName: 'Open Agent' });
}

export class OpenRouterModelCatalog implements ModelCatalog {
  readonly #provider: OpenRouterProvider | null;

  constructor(apiKey: string | null) {
    this.#provider = apiKey ? provider(apiKey) : null;
  }

  choose(role: ModelRole, modelId: string, ownKey: string | null): ModelChoice {
    // A provider is a few closures: making one per call for an own key costs nothing worth caching.
    const chosen = ownKey ? provider(ownKey) : this.#provider;
    if (!chosen) throw new ModelUnavailableError();
    const model = chosen.chat(modelId, { usage: { include: true }, reasoning: REASONING[role] });
    return { model, modelId, paidByUser: ownKey !== null };
  }

  costOf(metadata: ProviderMetadata | undefined): number | null {
    const usage = metadata?.openrouter?.usage;
    const cost = typeof usage === 'object' && usage !== null && 'cost' in usage ? usage.cost : null;
    return typeof cost === 'number' ? cost : null;
  }
}

/** OpenRouter describes the key that calls `/key`, and answers 401 to a key it does not know. */
export class OpenRouterKeyChecker implements KeyChecker {
  async accepts(apiKey: string): Promise<boolean> {
    const response = await fetch('https://openrouter.ai/api/v1/key', {
      headers: { authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 401 || response.status === 403) return false;
    if (!response.ok) throw new Error(`OpenRouter answered ${response.status} for the key check.`);
    return true;
  }
}
