import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import knex, { type Knex } from 'knex';

import { migrationSource } from './migrations/index.ts';

type SqliteConnection = { pragma(statement: string): unknown };

export function createDatabase(filename: string): Knex {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
  return knex({
    client: 'better-sqlite3',
    connection: { filename },
    useNullAsDefault: true,
    migrations: { migrationSource },
    pool: {
      afterCreate(connection: SqliteConnection, done: (error: Error | null) => void) {
        connection.pragma('foreign_keys = ON');
        connection.pragma('journal_mode = WAL');
        connection.pragma('busy_timeout = 5000');
        done(null);
      },
    },
  });
}
