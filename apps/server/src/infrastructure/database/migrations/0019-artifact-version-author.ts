import type { Knex } from 'knex';

/** The person who wrote a version by hand; `NULL` for the model's versions and those written before. */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('artifact_versions', (table) => {
    table.integer('user_id').nullable().references('id').inTable('users').onDelete('SET NULL');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('artifact_versions', (table) => {
    table.dropColumn('user_id');
  });
}
