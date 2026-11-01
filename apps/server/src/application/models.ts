import type { ProviderMetadata } from 'ai';

import type { ModelCatalog, ModelChoice, ModelRole } from './ports/model-catalog.ts';
import type { Settings } from './settings.ts';

/** The model each role uses now: the admin's setting, set up by the provider. */
export class Models {
  readonly #catalog: ModelCatalog;
  readonly #settings: Settings;

  constructor(catalog: ModelCatalog, settings: Settings) {
    this.#catalog = catalog;
    this.#settings = settings;
  }

  /** Throws `ModelUnavailableError` when no provider is configured. */
  choose(role: ModelRole): ModelChoice {
    return this.#catalog.choose(role, this.#settings.modelId(role));
  }

  costOf(metadata: ProviderMetadata | undefined): number | null {
    return this.#catalog.costOf(metadata);
  }
}
