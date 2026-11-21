import { createOpenRouter, type OpenRouterProvider } from '@openrouter/ai-sdk-provider';
import type { ProviderMetadata } from 'ai';

import {
  ModelUnavailableError,
  type KeyChecker,
  type ModelCatalog,
  type ModelChoice,
  type ModelRole,
  type Thinking,
} from '../../application/ports/model-catalog.ts';

/**
 * Tested on deepseek-v4.1-flash-1017 (2026-11-01): off, a title takes about 0.5 s with 0 reasoning tokens; `medium`
 * solved a train-crossing problem in 3.4 s for 0.0007 $, as well as `high` (5.8 s). Gemini 4 cannot turn thinking off
 * (2026-11-21): its first word comes after 2.3–3.6 s (Hydrogen) or 3.9–5.4 s (Neon), `low` or `medium` alike.
 */
const REASONING: Record<Thinking, { enabled: boolean; effort: 'none' | 'low' | 'medium' }> = {
  off: { enabled: false, effort: 'none' },
  low: { enabled: true, effort: 'low' },
  medium: { enabled: true, effort: 'medium' },
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

  choose(
    role: ModelRole,
    modelId: string,
    ownKey: string | null,
    thinking: Thinking,
  ): Omit<ModelChoice, 'capabilities'> {
    // A provider is a few closures: making one per call for an own key costs nothing worth caching.
    const chosen = ownKey ? provider(ownKey) : this.#provider;
    if (!chosen) throw new ModelUnavailableError();
    // The image model answers through the chat API too: its cost then comes as for any answer.
    if (role === 'image') {
      const model = chosen.chat(modelId, { usage: { include: true }, extraBody: { modalities: ['image', 'text'] } });
      return { model, modelId, paidByUser: ownKey !== null };
    }
    // Gemini 4's reasoning text is Google's summary, in English whatever the prompt's language (5 of 5, 2026-11-21):
    // it is not shown. The model still thinks, and the thinking is billed.
    const exclude = modelId.startsWith('google/');
    const model = chosen.chat(modelId, { usage: { include: true }, reasoning: { ...REASONING[thinking], exclude } });
    return { model, modelId, paidByUser: ownKey !== null };
  }

  costOf(metadata: ProviderMetadata | undefined, body?: unknown): number | null {
    return costIn(metadata?.openrouter?.usage) ?? costIn((body as { usage?: unknown } | undefined)?.usage);
  }
}

/** OpenRouter reports the billed cost as `usage.cost`: in the step's metadata, and in the reply's body. */
function costIn(usage: unknown): number | null {
  const cost = typeof usage === 'object' && usage !== null && 'cost' in usage ? usage.cost : null;
  return typeof cost === 'number' ? cost : null;
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
