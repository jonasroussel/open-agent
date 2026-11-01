import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('artifacts', (table) => {
    /** A UUID, in the model's tool calls and in the address `/api/artifacts/:id`. */
    table.string('id').primary();
    table.string('conversation_id').notNullable().references('id').inTable('conversations').onDelete('CASCADE');
    table.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.string('kind').notNullable();
    table.string('title').notNullable();
    table.string('created_at').notNullable();
    table.string('updated_at').notNullable();
    table.index('conversation_id');
  });

  await knex.schema.createTable('artifact_versions', (table) => {
    table.string('artifact_id').notNullable().references('id').inTable('artifacts').onDelete('CASCADE');
    /** From 1, in order. */
    table.integer('number').notNullable();
    table.text('content').notNullable();
    /** `model`: written by the assistant. `user`: edited by hand, or an old version brought back. */
    table.string('author').notNullable();
    table.string('created_at').notNullable();
    table.primary(['artifact_id', 'number']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('artifact_versions');
  await knex.schema.dropTable('artifacts');
}
