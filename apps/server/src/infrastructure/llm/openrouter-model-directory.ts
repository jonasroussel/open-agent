import type { ModelCapability } from '@open-agent/shared';

import type { ModelDirectory, ModelInfo } from '../../application/ports/model-catalog.ts';

const MODELS_URL = 'https://openrouter.ai/api/v1/models';
/** The list changes a few times a day at most. */
const CACHE_MS = 60 * 60 * 1000;

type OpenRouterModel = {
  id: string;
  name: string;
  architecture: { input_modalities: string[]; output_modalities?: string[] };
  supported_parameters?: string[];
  reasoning?: { mandatory?: boolean };
  pricing: { prompt: string; completion: string };
};

/** OpenRouter's public model list (no key needed), kept an hour. */
export class OpenRouterModelDirectory implements ModelDirectory {
  #cache: { at: number; models: ModelInfo[] } | null = null;
  #loading: Promise<ModelInfo[]> | null = null;

  async list(): Promise<ModelInfo[]> {
    const cache = this.#cache;
    if (cache && Date.now() - cache.at < CACHE_MS) return cache.models;
    if (!this.#loading) {
      this.#loading = this.#load().finally(() => (this.#loading = null));
      if (cache) this.#loading.catch((error) => console.error('Refreshing the models failed:', error));
    }
    // Every answer looks its model up: past the hour the old list answers at once while the new one loads.
    return cache ? cache.models : this.#loading;
  }

  async #load(): Promise<ModelInfo[]> {
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
  const inputs = model.architecture.input_modalities;
  for (const modality of ['text', 'image', 'audio', 'video', 'file'] as const) {
    if (inputs.includes(modality)) capabilities.push(modality);
  }
  if (parameters.includes('tools')) capabilities.push('tools');
  if (parameters.includes('reasoning')) capabilities.push('reasoning');
  if (!model.reasoning?.mandatory) capabilities.push('thinking_off');
  if (parameters.includes('structured_outputs')) capabilities.push('structured_outputs');
  if (model.architecture.output_modalities?.includes('image')) capabilities.push('image_output');
  // Routers (`openrouter/auto`…) give "-1": their price is the one of the model they pick.
  const variable = Number(model.pricing.prompt) < 0 || Number(model.pricing.completion) < 0;
  return {
    id: model.id,
    name: model.name,
    capabilities,
    inputPrice: variable ? null : Number(model.pricing.prompt) * 1_000_000,
    outputPrice: variable ? null : Number(model.pricing.completion) * 1_000_000,
  };
}
