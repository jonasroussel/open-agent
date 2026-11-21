import type { ModelCapability } from '@open-agent/shared';

import type { User } from '../domain/user.ts';
import type {
  ModelCatalog,
  ModelChoice,
  ModelDirectory,
  ModelInfo,
  ModelRole,
  Thinking,
} from './ports/model-catalog.ts';
import type { SecretBox } from './ports/secret-box.ts';
import type { Settings } from './settings.ts';

/** The model each role uses now: the admin's setting, paid by the user's own key when they gave one. */
export class Models {
  readonly #catalog: ModelCatalog;
  readonly #settings: Settings;
  readonly #secrets: SecretBox;
  readonly #directory: ModelDirectory;

  constructor(catalog: ModelCatalog, settings: Settings, secrets: SecretBox, directory: ModelDirectory) {
    this.#catalog = catalog;
    this.#settings = settings;
    this.#secrets = secrets;
    this.#directory = directory;
  }

  /** Throws `ModelUnavailableError` when neither the app nor the user has a key. */
  async choose(role: ModelRole, user: User): Promise<ModelChoice> {
    return this.#choose(role, this.#settings.modelId(role), user);
  }

  /** The model the admin picked for a comparison, answering `route` as the role's own model would. */
  async choosePicked(route: 'fast' | 'reasoning', modelId: string, user: User): Promise<ModelChoice> {
    return this.#choose(route, modelId, user);
  }

  /** Whether a comparison may pick it: answers use tools. Throws when the provider's list cannot be reached. */
  async comparable(modelId: string): Promise<boolean> {
    return (await this.#find(modelId))?.capabilities.includes('tools') === true;
  }

  async #choose(role: ModelRole, modelId: string, user: User): Promise<ModelChoice> {
    let capabilities: readonly ModelCapability[] = [];
    try {
      capabilities = (await this.#find(modelId))?.capabilities ?? [];
    } catch (error) {
      console.error('Listing the models failed:', error);
    }
    const choice = this.#catalog.choose(role, modelId, this.#ownKey(user), Models.#thinking(role, capabilities));
    return { ...choice, capabilities };
  }

  /**
   * The reasoning role thinks when the model can; the others answer without thinking, or as little as the model
   * allows when its thinking cannot be turned off (OpenRouter refuses the call otherwise). Unknown capabilities (the
   * provider's list cannot be reached): the role's usual setting.
   */
  static #thinking(role: ModelRole, capabilities: readonly ModelCapability[]): Thinking {
    const known = capabilities.length > 0;
    if (role === 'reasoning' && (!known || capabilities.includes('reasoning'))) return 'medium';
    if (known && !capabilities.includes('thinking_off')) return 'low';
    return 'off';
  }

  async #find(modelId: string): Promise<ModelInfo | undefined> {
    return (await this.#directory.list()).find((model) => model.id === modelId);
  }

  #ownKey(user: User): string | null {
    return user.ownKey ? this.#secrets.open(user.ownKey.sealed) : null;
  }
}
