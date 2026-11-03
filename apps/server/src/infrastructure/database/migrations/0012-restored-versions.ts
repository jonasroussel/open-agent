import type { Knex } from 'knex';

/** A version the user brought back from an older one: the model is told, so it does not redo what was undone. */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('artifact_versions', (table) => {
    table.integer('restored_from').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('artifact_versions', (table) => {
    table.dropColumn('restored_from');
  });
}
