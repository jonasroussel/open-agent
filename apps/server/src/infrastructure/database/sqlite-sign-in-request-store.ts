import type { Locale } from '@open-agent/shared';
import type { Knex } from 'knex';

import {
  MAX_CODE_TRIES,
  type NewSignInRequest,
  type SignInRequestStore,
  type SignInSecrets,
  type UsedSignInRequest,
} from '../../application/ports/sign-in-request-store.ts';
import { randomCode, randomToken, sha256 } from '../secrets.ts';

type UsedRow = { user_id: number; locale: Locale | null };

export class SqliteSignInRequestStore implements SignInRequestStore {
  readonly #database: Knex;

  constructor(database: Knex) {
    this.#database = database;
  }

  async create(request: NewSignInRequest): Promise<SignInSecrets> {
    const token = randomToken();
    const code = request.withCode ? randomCode() : null;
    await this.#database('sign_in_requests').where('expires_at', '<=', request.now.toISOString()).delete();
    if (request.withCode) {
      await this.#database('sign_in_requests').where({ user_id: request.userId }).whereNotNull('code_hash').delete();
    }
    await this.#database('sign_in_requests').insert({
      user_id: request.userId,
      token_hash: sha256(token),
      code_hash: code === null ? null : sha256(code),
      expires_at: request.expiresAt.toISOString(),
      locale: request.withCode ? request.locale : null,
    });
    return { token, code };
  }

  async useToken(token: string, now: Date): Promise<UsedSignInRequest | null> {
    return this.#use(this.#database('sign_in_requests').where({ token_hash: sha256(token) }), now);
  }

  /** The try is counted before the code is compared, so simultaneous guesses cannot slip past the limit. */
  async useCode(userId: number, code: string, now: Date): Promise<UsedSignInRequest | null> {
    const tried: { id: number; code_hash: string }[] = await this.#database('sign_in_requests')
      .where({ user_id: userId })
      .whereNotNull('code_hash')
      .whereNull('used_at')
      .andWhere('expires_at', '>', now.toISOString())
      .andWhere('code_tries', '<', MAX_CODE_TRIES)
      .update({ code_tries: this.#database.raw('code_tries + 1') }, ['id', 'code_hash']);
    const matching = tried.find((request) => request.code_hash === sha256(code));
    return matching ? this.#use(this.#database('sign_in_requests').where({ id: matching.id }), now) : null;
  }

  /** One statement: a second, simultaneous use finds the request already used. */
  async #use(query: Knex.QueryBuilder, now: Date): Promise<UsedSignInRequest | null> {
    const at = now.toISOString();
    const [row]: UsedRow[] = await query
      .whereNull('used_at')
      .andWhere('expires_at', '>', at)
      .update({ used_at: at }, ['user_id', 'locale']);
    return row ? { userId: row.user_id, locale: row.locale } : null;
  }
}
