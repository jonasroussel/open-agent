import type { ProviderMetadata } from 'ai';

import type { User } from '../domain/user.ts';
import type { ModelCatalog, ModelChoice, ModelRole } from './ports/model-catalog.ts';
import type { SecretBox } from './ports/secret-box.ts';
import type { Settings } from './settings.ts';

/** The model each role uses now: the admin's setting, paid by the user's own key when they gave one. */
export class Models {
  readonly #catalog: ModelCatalog;
  readonly #settings: Settings;
  readonly #secrets: SecretBox;

  constructor(catalog: ModelCatalog, settings: Settings, secrets: SecretBox) {
    this.#catalog = catalog;
    this.#settings = settings;
    this.#secrets = secrets;
  }

  /** Throws `ModelUnavailableError` when neither the app nor the user has a key. */
  choose(role: ModelRole, user: User): ModelChoice {
    const ownKey = user.ownKey ? this.#secrets.open(user.ownKey.sealed) : null;
    return this.#catalog.choose(role, this.#settings.modelId(role), ownKey);
  }

  costOf(metadata: ProviderMetadata | undefined): number | null {
    return this.#catalog.costOf(metadata);
  }
}
