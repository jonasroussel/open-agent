import type { Knex } from 'knex';

/** A user's own OpenRouter key, encrypted; the calls it pays for no longer count against their quota. */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('users', (table) => {
    table.text('own_key_sealed').nullable();
    table.string('own_key_added_at').nullable();
  });
  await knex.schema.alterTable('usage_events', (table) => {
    table.boolean('paid_by_user').notNullable().defaultTo(false);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('usage_events', (table) => {
    table.dropColumn('paid_by_user');
  });
  await knex.schema.alterTable('users', (table) => {
    table.dropColumn('own_key_added_at');
    table.dropColumn('own_key_sealed');
  });
}
