import type { Knex } from 'knex';

/** The user orders their commands; existing ones keep the order they showed in (most used first, then by name). */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('commands', (table) => {
    table.integer('position').notNullable().defaultTo(0);
  });
  const rows: { id: string; user_id: number }[] = await knex('commands')
    .select('id', 'user_id')
    .orderBy([{ column: 'user_id' }, { column: 'uses', order: 'desc' }, { column: 'name' }]);
  const next = new Map<number, number>();
  for (const row of rows) {
    const position = next.get(row.user_id) ?? 0;
    next.set(row.user_id, position + 1);
    await knex('commands').where({ id: row.id }).update({ position });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('commands', (table) => {
    table.dropColumn('position');
  });
}
