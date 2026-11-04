import type { Knex } from 'knex';

/**
 * The people a conversation is shared with, besides its owner (`conversations.user_id`): invited until they join.
 * Each member pins it for themselves.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('conversation_members', (table) => {
    table.string('conversation_id').notNullable().references('id').inTable('conversations').onDelete('CASCADE');
    table.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    /** `invited`, then `member` once they joined. */
    table.string('status').notNullable();
    table.boolean('pinned').notNullable().defaultTo(false);
    table.string('invited_at').notNullable();
    table.string('joined_at').nullable();
    table.primary(['conversation_id', 'user_id']);
    table.index('user_id');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('conversation_members');
}
