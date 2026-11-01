import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('memory_rules', (table) => {
    table.increments('id');
    table.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.string('text').notNullable();
    table.string('created_at').notNullable();
    table.string('updated_at').notNullable();
    /** Forgotten rules are kept until then, so undoing a deletion brings the same rule back. */
    table.string('deleted_at').nullable();
    table.index('user_id');
  });

  await knex.schema.createTable('memory_rule_changes', (table) => {
    table.increments('id');
    table.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.integer('rule_id').notNullable().references('id').inTable('memory_rules').onDelete('CASCADE');
    table.string('operation').notNullable();
    table.string('before_text').nullable();
    table.string('after_text').nullable();
    /** `remark`: the assistant, from something the user said. `user`: the memory page. */
    table.string('source').notNullable();
    table.string('conversation_id').nullable().references('id').inTable('conversations').onDelete('SET NULL');
    /** The answer whose notice shows the change. */
    table.string('message_id').nullable();
    table.string('created_at').notNullable();
    table.string('undone_at').nullable();
    table.index('user_id');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('memory_rule_changes');
  await knex.schema.dropTable('memory_rules');
}
