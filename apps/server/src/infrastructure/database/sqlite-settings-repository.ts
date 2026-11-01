import type { Knex } from 'knex';

import type { SettingsRepository } from '../../domain/settings-repository.ts';

export class SqliteSettingsRepository implements SettingsRepository {
  readonly #database: Knex;

  constructor(database: Knex) {
    this.#database = database;
  }

  async all(): Promise<Map<string, string>> {
    const rows: { key: string; value: string }[] = await this.#database('settings').select('key', 'value');
    return new Map(rows.map((row) => [row.key, row.value]));
  }

  async set(key: string, value: string | null, now: Date): Promise<void> {
    if (value === null) {
      await this.#database('settings').where({ key }).delete();
      return;
    }
    await this.#database('settings')
      .insert({ key, value, updated_at: now.toISOString() })
      .onConflict('key')
      .merge(['value', 'updated_at']);
  }
}
