import type { Locale, UserRole } from '@open-agent/shared';
import type { Knex } from 'knex';

import type { NewUser, UserRepository } from '../../domain/user-repository.ts';
import type { OwnKey, User } from '../../domain/user.ts';

type UserRow = {
  id: number;
  email: string;
  name: string | null;
  role: UserRole;
  locale: Locale;
  invited_at: string;
  last_sign_in_at: string | null;
  revoked_at: string | null;
  monthly_quota_usd: number | null;
  own_key_sealed: string | null;
  own_key_added_at: string | null;
};

const COLUMNS = [
  'id',
  'email',
  'name',
  'role',
  'locale',
  'invited_at',
  'last_sign_in_at',
  'revoked_at',
  'monthly_quota_usd',
  'own_key_sealed',
  'own_key_added_at',
] as const;

export class SqliteUserRepository implements UserRepository {
  readonly #database: Knex;

  constructor(database: Knex) {
    this.#database = database;
  }

  async findById(id: number): Promise<User | null> {
    const row: UserRow | undefined = await this.#database('users').where({ id }).first(COLUMNS);
    return row ? toUser(row) : null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const row: UserRow | undefined = await this.#database('users').where({ email }).first(COLUMNS);
    return row ? toUser(row) : null;
  }

  async list(): Promise<User[]> {
    const rows: UserRow[] = await this.#database('users').select(COLUMNS).orderBy('id');
    return rows.map(toUser);
  }

  async create(user: NewUser): Promise<User> {
    const [id] = await this.#database('users').insert({
      email: user.email,
      role: user.role,
      locale: user.locale,
      invited_by: user.invitedBy,
      invited_at: user.invitedAt.toISOString(),
    });
    return {
      ...user,
      id: id!,
      name: null,
      lastSignInAt: null,
      revokedAt: null,
      monthlyQuotaUsd: null,
      ownKey: null,
    };
  }

  async setRole(id: number, role: UserRole): Promise<void> {
    await this.#database('users').where({ id }).update({ role });
  }

  async setLocale(id: number, locale: Locale): Promise<void> {
    await this.#database('users').where({ id }).update({ locale });
  }

  async recordSignIn(id: number, at: Date): Promise<void> {
    await this.#database('users').where({ id }).update({ last_sign_in_at: at.toISOString() });
  }

  async revoke(id: number, at: Date): Promise<void> {
    await this.#database('users').where({ id }).update({ revoked_at: at.toISOString() });
  }

  async restore(id: number): Promise<void> {
    await this.#database('users').where({ id }).update({ revoked_at: null });
  }

  async setMonthlyQuota(id: number, usd: number): Promise<void> {
    await this.#database('users').where({ id }).update({ monthly_quota_usd: usd });
  }

  async setName(id: number, name: string | null): Promise<void> {
    await this.#database('users').where({ id }).update({ name });
  }

  async setOwnKey(id: number, ownKey: OwnKey | null): Promise<void> {
    await this.#database('users')
      .where({ id })
      .update({ own_key_sealed: ownKey?.sealed ?? null, own_key_added_at: ownKey?.addedAt.toISOString() ?? null });
  }
}

function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    locale: row.locale,
    invitedAt: new Date(row.invited_at),
    lastSignInAt: row.last_sign_in_at ? new Date(row.last_sign_in_at) : null,
    revokedAt: row.revoked_at ? new Date(row.revoked_at) : null,
    monthlyQuotaUsd: row.monthly_quota_usd,
    ownKey:
      row.own_key_sealed && row.own_key_added_at
        ? { sealed: row.own_key_sealed, addedAt: new Date(row.own_key_added_at) }
        : null,
  };
}
