import type { Knex } from 'knex';

import type {
  NewSignInRequest,
  SignInRequestStore,
  SignInSecrets,
} from '../../application/ports/sign-in-request-store.ts';
import { randomCode, randomToken, sha256 } from '../secrets.ts';

export class SqliteSignInRequestStore implements SignInRequestStore {
  readonly #database: Knex;

  constructor(database: Knex) {
    this.#database = database;
  }

  async create({ userId, expiresAt, withCode, now }: NewSignInRequest): Promise<SignInSecrets> {
    const token = randomToken();
    const code = withCode ? randomCode() : null;
    await this.#database('sign_in_requests').where('expires_at', '<=', now.toISOString()).delete();
    await this.#database('sign_in_requests').insert({
      user_id: userId,
      token_hash: sha256(token),
      code_hash: code === null ? null : sha256(code),
      expires_at: expiresAt.toISOString(),
    });
    return { token, code };
  }

  async useToken(token: string, now: Date): Promise<number | null> {
    return this.#use(this.#database('sign_in_requests').where({ token_hash: sha256(token) }), now);
  }

  async useCode(userId: number, code: string, now: Date): Promise<boolean> {
    const query = this.#database('sign_in_requests').where({ user_id: userId, code_hash: sha256(code) });
    return (await this.#use(query, now)) !== null;
  }

  /** The `used_at IS NULL` condition in the update makes a second, simultaneous use find nothing to update. */
  async #use(query: Knex.QueryBuilder, now: Date): Promise<number | null> {
    const at = now.toISOString();
    const row: { id: number; user_id: number } | undefined = await query
      .clone()
      .whereNull('used_at')
      .andWhere('expires_at', '>', at)
      .first('id', 'user_id');
    if (!row) return null;
    const updated = await this.#database('sign_in_requests')
      .where({ id: row.id })
      .whereNull('used_at')
      .update({ used_at: at });
    return updated === 1 ? row.user_id : null;
  }
}
