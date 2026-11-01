import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('settings', (table) => {
    /** `model.fast`, `prompt.assistant`…; a missing key means the default from the code or the environment. */
    table.string('key').primary();
    table.text('value').notNullable();
    table.string('updated_at').notNullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('settings');
}
