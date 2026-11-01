import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('conversations', (table) => {
    /** A Lucide icon name chosen with the title, e.g. `fuel`; `null` until then. */
    table.string('icon').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('conversations', (table) => {
    table.dropColumn('icon');
  });
}
