import type { Knex } from 'knex';

/**
 * Message ids come from the client: unique within their conversation only. With a global key, the same id in two
 * conversations (anyone's) made the second save fail. SQLite cannot change a primary key: the table is rebuilt.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.renameTable('messages', 'messages_old');
  await knex.schema.createTable('messages', (table) => {
    table.string('conversation_id').notNullable().references('id').inTable('conversations').onDelete('CASCADE');
    table.string('id').notNullable();
    table.integer('position').notNullable();
    table.string('role').notNullable();
    /** The whole AI SDK UI message (parts and metadata), as JSON. */
    table.text('content').notNullable();
    table.primary(['conversation_id', 'id']);
    // The renamed old table still holds the default index name until it is dropped.
    table.unique(['conversation_id', 'position'], { indexName: 'messages_position_per_conversation' });
  });
  await knex.raw(
    'INSERT INTO messages (conversation_id, id, position, role, content) SELECT conversation_id, id, position, role, content FROM messages_old',
  );
  await knex.schema.dropTable('messages_old');
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.renameTable('messages', 'messages_new');
  await knex.schema.createTable('messages', (table) => {
    table.string('id').primary();
    table.string('conversation_id').notNullable().references('id').inTable('conversations').onDelete('CASCADE');
    table.integer('position').notNullable();
    table.string('role').notNullable();
    table.text('content').notNullable();
    table.unique(['conversation_id', 'position']);
  });
  await knex.raw(
    'INSERT INTO messages (id, conversation_id, position, role, content) SELECT id, conversation_id, position, role, content FROM messages_new',
  );
  await knex.schema.dropTable('messages_new');
}
