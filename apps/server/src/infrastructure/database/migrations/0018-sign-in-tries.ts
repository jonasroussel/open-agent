import type { Knex } from 'knex';

/**
 * Codes typed against a request: it is refused after a few, and a restart does not reset the count. The locale the
 * form asked for is given to the user only once the link or the code proves who they are.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('sign_in_requests', (table) => {
    table.integer('code_tries').notNullable().defaultTo(0);
    table.string('locale').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('sign_in_requests', (table) => {
    table.dropColumn('code_tries');
    table.dropColumn('locale');
  });
}
