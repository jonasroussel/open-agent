import type { Knex } from 'knex';

/**
 * The right thread of a comparison: `compared_with` names the left conversation, without a foreign key since both are
 * created at once by two requests, either first. `model_id`: the model the admin picked to answer it.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('conversations', (table) => {
    table.string('compared_with').nullable().index();
    table.string('model_id').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('conversations', (table) => {
    table.dropIndex('compared_with');
    table.dropColumn('compared_with');
    table.dropColumn('model_id');
  });
}
