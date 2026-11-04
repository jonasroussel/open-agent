import type { Knex } from 'knex';

/** A conversation outside the history: deleted when its page is left, or a day later at the latest. */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('conversations', (table) => {
    table.boolean('ephemeral').notNullable().defaultTo(false);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('conversations', (table) => {
    table.dropColumn('ephemeral');
  });
}
