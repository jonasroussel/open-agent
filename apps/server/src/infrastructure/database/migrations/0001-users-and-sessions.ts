import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('users', (table) => {
    table.increments('id');
    table.string('email').notNullable().unique();
    table.string('role').notNullable();
    table.string('locale').notNullable();
    table.string('invited_at').notNullable();
    table.integer('invited_by').nullable().references('id').inTable('users').onDelete('SET NULL');
    table.string('last_sign_in_at').nullable();
    table.string('revoked_at').nullable();
  });

  await knex.schema.createTable('sessions', (table) => {
    table.string('token_hash').primary();
    table.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.string('expires_at').notNullable();
    table.index('user_id');
  });

  await knex.schema.createTable('sign_in_requests', (table) => {
    table.increments('id');
    table.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.string('token_hash').notNullable().unique();
    table.string('code_hash').nullable();
    table.string('expires_at').notNullable();
    table.string('used_at').nullable();
    table.index('user_id');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('sign_in_requests');
  await knex.schema.dropTable('sessions');
  await knex.schema.dropTable('users');
}
