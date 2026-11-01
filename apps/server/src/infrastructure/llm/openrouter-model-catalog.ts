import { createOpenRouter, type OpenRouterProvider } from '@openrouter/ai-sdk-provider';
import type { ProviderMetadata } from 'ai';

import {
  ModelUnavailableError,
  type ModelCatalog,
  type ModelChoice,
  type ModelRole,
} from '../../application/ports/model-catalog.ts';

export type ModelIds = Record<ModelRole, string>;

/**
 * Thinking per role, tested on deepseek-v4.1-flash-1017 (2026-11-01): off, a title takes about 0.5 s with 0 reasoning
 * tokens; `medium` solved a train-crossing problem in 3.4 s for 0.0007 $, as well as `high` (5.8 s).
 */
const REASONING: Record<ModelRole, { enabled: boolean; effort: 'none' | 'medium' }> = {
  fast: { enabled: false, effort: 'none' },
  reasoning: { enabled: true, effort: 'medium' },
  background: { enabled: false, effort: 'none' },
};

export class OpenRouterModelCatalog implements ModelCatalog {
  readonly #provider: OpenRouterProvider | null;
  readonly #modelIds: ModelIds;

  constructor(apiKey: string | null, modelIds: ModelIds) {
    // `strict` sends `stream_options.include_usage`: the cost then arrives at the end of a streamed answer too.
    this.#provider = apiKey ? createOpenRouter({ apiKey, compatibility: 'strict', appName: 'Open Agent' }) : null;
    this.#modelIds = modelIds;
  }

  choose(role: ModelRole): ModelChoice {
    if (!this.#provider) throw new ModelUnavailableError();
    const modelId = this.#modelIds[role];
    const model = this.#provider.chat(modelId, { usage: { include: true }, reasoning: REASONING[role] });
    return { model, modelId };
  }

  costOf(metadata: ProviderMetadata | undefined): number | null {
    const usage = metadata?.openrouter?.usage;
    const cost = typeof usage === 'object' && usage !== null && 'cost' in usage ? usage.cost : null;
    return typeof cost === 'number' ? cost : null;
  }
}
