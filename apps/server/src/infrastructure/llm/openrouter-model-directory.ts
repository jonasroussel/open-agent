import type { ModelCapability } from '@open-agent/shared';

import type { ModelDirectory, ModelInfo } from '../../application/ports/model-catalog.ts';

const MODELS_URL = 'https://openrouter.ai/api/v1/models';
/** The list changes a few times a day at most; the admin page opens it now and then. */
const CACHE_MS = 60 * 60 * 1000;

type OpenRouterModel = {
  id: string;
  name: string;
  architecture: { input_modalities: string[] };
  supported_parameters?: string[];
  reasoning?: { mandatory?: boolean };
  pricing: { prompt: string; completion: string };
};

/** OpenRouter's public model list (no key needed), kept an hour. */
export class OpenRouterModelDirectory implements ModelDirectory {
  #cache: { at: number; models: ModelInfo[] } | null = null;

  async list(): Promise<ModelInfo[]> {
    if (this.#cache && Date.now() - this.#cache.at < CACHE_MS) return this.#cache.models;
    const response = await fetch(MODELS_URL, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`OpenRouter answered ${response.status} for its models.`);
    const { data } = (await response.json()) as { data: OpenRouterModel[] };
    // `:batch` variants answer later, in batches: useless for a conversation.
    const models = data.filter((model) => !model.id.endsWith(':batch')).map(toModelInfo);
    this.#cache = { at: Date.now(), models };
    return models;
  }
}

function toModelInfo(model: OpenRouterModel): ModelInfo {
  const parameters = model.supported_parameters ?? [];
  const capabilities: ModelCapability[] = [];
  if (model.architecture.input_modalities.includes('text')) capabilities.push('text');
  if (model.architecture.input_modalities.includes('image')) capabilities.push('image');
  if (parameters.includes('tools')) capabilities.push('tools');
  if (parameters.includes('reasoning')) capabilities.push('reasoning');
  if (!model.reasoning?.mandatory) capabilities.push('thinking_off');
  if (parameters.includes('structured_outputs')) capabilities.push('structured_outputs');
  return {
    id: model.id,
    name: model.name,
    capabilities,
    inputPrice: Number(model.pricing.prompt) * 1_000_000,
    outputPrice: Number(model.pricing.completion) * 1_000_000,
  };
}
