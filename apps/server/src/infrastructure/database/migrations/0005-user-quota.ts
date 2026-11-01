import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('users', (table) => {
    /** In USD per calendar month; `null`: the default quota. Admins have none. */
    table.float('monthly_quota_usd').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('users', (table) => {
    table.dropColumn('monthly_quota_usd');
  });
}
