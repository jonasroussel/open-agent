import type { Knex } from 'knex';

import type { SessionStore } from '../../application/ports/session-store.ts';
import { randomToken, sha256 } from '../secrets.ts';

export class SqliteSessionStore implements SessionStore {
  readonly #database: Knex;

  constructor(database: Knex) {
    this.#database = database;
  }

  async create(userId: number, expiresAt: Date, now: Date): Promise<string> {
    const token = randomToken();
    await this.#database('sessions').where('expires_at', '<=', now.toISOString()).delete();
    await this.#database('sessions').insert({
      token_hash: sha256(token),
      user_id: userId,
      expires_at: expiresAt.toISOString(),
    });
    return token;
  }

  async findUserId(token: string, now: Date): Promise<number | null> {
    const row: { user_id: number } | undefined = await this.#database('sessions')
      .where({ token_hash: sha256(token) })
      .andWhere('expires_at', '>', now.toISOString())
      .first('user_id');
    return row?.user_id ?? null;
  }

  async delete(token: string): Promise<void> {
    await this.#database('sessions')
      .where({ token_hash: sha256(token) })
      .delete();
  }

  async deleteAllOf(userId: number): Promise<void> {
    await this.#database('sessions').where({ user_id: userId }).delete();
  }
}
