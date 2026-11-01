import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('library_files', (table) => {
    /** A UUID, also in the file's address `/api/files/:id`. */
    table.string('id').primary();
    table.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.string('name').notNullable();
    table.string('kind').notNullable();
    table.string('media_type').notNullable();
    table.integer('size').notNullable();
    /** What the model reads, as JSON `FilePiece[]`: the whole text, and the names of the pictures stored on disk. */
    table.text('content').notNullable();
    table.string('created_at').notNullable();
    table.index(['user_id', 'created_at']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('library_files');
}
