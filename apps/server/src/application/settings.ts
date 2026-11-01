import {
  MAX_PROMPT_LENGTH,
  missingCapabilities,
  MODEL_ROLES,
  PROMPT_NAMES,
  type ModelRole,
  type PromptName,
} from '@open-agent/shared';

import type { SettingsRepository } from '../domain/settings-repository.ts';
import { DEFAULT_PROMPTS } from './default-prompts.ts';
import type { Clock } from './ports/clock.ts';
import type { ModelDirectory, ModelInfo } from './ports/model-catalog.ts';

export type SetModelResult =
  | { ok: true; model: ModelInfo }
  | { ok: false; reason: 'invalid_request' | 'model_not_found' | 'model_unsuitable' };

const modelKey = (role: ModelRole) => `model.${role}`;
const promptKey = (name: PromptName) => `prompt.${name}`;

function byRole<T>(value: (role: ModelRole) => T): Record<ModelRole, T> {
  return Object.fromEntries(MODEL_ROLES.map((role) => [role, value(role)])) as Record<ModelRole, T>;
}

function byName<T>(value: (name: PromptName) => T): Record<PromptName, T> {
  return Object.fromEntries(PROMPT_NAMES.map((name) => [name, value(name)])) as Record<PromptName, T>;
}

/**
 * What the admin changes at runtime: the model of each role and the prompts. Read at every call from memory; a
 * change applies to the next message, without a restart. Unset, the environment's models and the code's prompts apply.
 */
export class Settings {
  readonly #repository: SettingsRepository;
  readonly #directory: ModelDirectory;
  readonly #clock: Clock;
  readonly #defaultModels: Record<ModelRole, string>;
  readonly #values: Map<string, string>;

  private constructor(
    repository: SettingsRepository,
    directory: ModelDirectory,
    clock: Clock,
    defaultModels: Record<ModelRole, string>,
    values: Map<string, string>,
  ) {
    this.#repository = repository;
    this.#directory = directory;
    this.#clock = clock;
    this.#defaultModels = defaultModels;
    this.#values = values;
  }

  static async load(
    repository: SettingsRepository,
    directory: ModelDirectory,
    clock: Clock,
    defaultModels: Record<ModelRole, string>,
  ): Promise<Settings> {
    return new Settings(repository, directory, clock, defaultModels, await repository.all());
  }

  modelId(role: ModelRole): string {
    return this.#values.get(modelKey(role)) ?? this.#defaultModels[role];
  }

  prompt(name: PromptName): string {
    return this.#values.get(promptKey(name)) ?? DEFAULT_PROMPTS[name];
  }

  view() {
    return {
      models: byRole((role) => this.modelId(role)),
      defaultModels: byRole((role) => this.#defaultModels[role]),
      prompts: byName((name) => this.prompt(name)),
      defaultPrompts: DEFAULT_PROMPTS,
    };
  }

  /** Checked against the provider: the model must exist and do what its role needs. The default clears the setting. */
  async setModel(role: unknown, modelId: unknown): Promise<SetModelResult> {
    if (!MODEL_ROLES.includes(role as ModelRole) || typeof modelId !== 'string' || !modelId.trim()) {
      return { ok: false, reason: 'invalid_request' };
    }
    const id = modelId.trim();
    const model = (await this.#directory.list()).find((candidate) => candidate.id === id);
    if (!model) return { ok: false, reason: 'model_not_found' };
    if (missingCapabilities(role as ModelRole, model.capabilities).length > 0) {
      return { ok: false, reason: 'model_unsuitable' };
    }
    await this.#save(modelKey(role as ModelRole), id === this.#defaultModels[role as ModelRole] ? null : id);
    return { ok: true, model };
  }

  /** `null`, or the default text itself, brings the default back. */
  async setPrompt(name: unknown, text: unknown): Promise<boolean> {
    if (!PROMPT_NAMES.includes(name as PromptName)) return false;
    if (text !== null && (typeof text !== 'string' || !text.trim() || text.length > MAX_PROMPT_LENGTH)) return false;
    const value = text === null || text.trim() === DEFAULT_PROMPTS[name as PromptName] ? null : text.trim();
    await this.#save(promptKey(name as PromptName), value);
    return true;
  }

  async #save(key: string, value: string | null): Promise<void> {
    await this.#repository.set(key, value, this.#clock.now());
    if (value === null) this.#values.delete(key);
    else this.#values.set(key, value);
  }
}
