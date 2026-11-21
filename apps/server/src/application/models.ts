import type { User } from '../domain/user.ts';
import type { ModelCatalog, ModelChoice, ModelDirectory, ModelInfo, ModelRole } from './ports/model-catalog.ts';
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
  choose(role: ModelRole, user: User): ModelChoice {
    return this.#catalog.choose(role, this.#settings.modelId(role), this.#ownKey(user));
  }

  /**
   * The model the admin picked for a comparison, answering `route`: it thinks on the reasoning route when it can, and on
   * every route when its thinking cannot be turned off (OpenRouter refuses the call otherwise). It answers as on the fast
   * route when the provider's list cannot be reached.
   */
  async choosePicked(route: 'fast' | 'reasoning', modelId: string, user: User): Promise<ModelChoice> {
    let thinks = false;
    try {
      const model = await this.#find(modelId);
      if (model) {
        const canThink = route === 'reasoning' && model.capabilities.includes('reasoning');
        thinks = canThink || !model.capabilities.includes('thinking_off');
      }
    } catch (error) {
      console.error('Listing the models failed:', error);
    }
    return this.#catalog.choose(thinks ? 'reasoning' : 'fast', modelId, this.#ownKey(user));
  }

  /** Whether a comparison may pick it: answers use tools. Throws when the provider's list cannot be reached. */
  async comparable(modelId: string): Promise<boolean> {
    return (await this.#find(modelId))?.capabilities.includes('tools') === true;
  }

  async #find(modelId: string): Promise<ModelInfo | undefined> {
    return (await this.#directory.list()).find((model) => model.id === modelId);
  }

  #ownKey(user: User): string | null {
    return user.ownKey ? this.#secrets.open(user.ownKey.sealed) : null;
  }
}
