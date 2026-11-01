import type { Knex } from 'knex';

/** The text parts of a message (`row` is `new` or `old`), one per line: what the person typed or read. */
const textOf = (row: string) => `(
  SELECT group_concat(json_extract(part.value, '$.text'), char(10))
  FROM json_each(${row}.content, '$.parts') AS part
  WHERE json_extract(part.value, '$.type') = 'text'
)`;

/**
 * Full-text search in the history. One row per message, sharing its `rowid`; triggers keep it in step with every
 * write, cascades included. `remove_diacritics` lets « ete » find « été ».
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`CREATE VIRTUAL TABLE message_search USING fts5(text, tokenize = 'unicode61 remove_diacritics 2')`);
  await knex.raw(`
    CREATE TRIGGER message_search_insert AFTER INSERT ON messages BEGIN
      INSERT INTO message_search (rowid, text) VALUES (new.rowid, ${textOf('new')});
    END`);
  await knex.raw(`
    CREATE TRIGGER message_search_delete AFTER DELETE ON messages BEGIN
      DELETE FROM message_search WHERE rowid = old.rowid;
    END`);
  await knex.raw(`
    CREATE TRIGGER message_search_update AFTER UPDATE OF content ON messages BEGIN
      DELETE FROM message_search WHERE rowid = old.rowid;
      INSERT INTO message_search (rowid, text) VALUES (new.rowid, ${textOf('new')});
    END`);
  await knex.raw(`INSERT INTO message_search (rowid, text) SELECT messages.rowid, ${textOf('messages')} FROM messages`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP TRIGGER message_search_update');
  await knex.raw('DROP TRIGGER message_search_delete');
  await knex.raw('DROP TRIGGER message_search_insert');
  await knex.raw('DROP TABLE message_search');
}
