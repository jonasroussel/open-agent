import type { Knex } from 'knex';

/** Requests a user saved to run again with `/name`. */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('commands', (table) => {
    table.string('id').primary();
    table.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.string('name').notNullable();
    table.text('prompt').notNullable();
    table.integer('uses').notNullable().defaultTo(0);
    table.string('created_at').notNullable();
    table.string('updated_at').notNullable();
    table.unique(['user_id', 'name']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('commands');
}
