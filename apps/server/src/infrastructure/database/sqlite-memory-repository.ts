import type { MemoryOperation } from '@open-agent/shared';
import type { Knex } from 'knex';

import type { MemoryRepository, NewMemoryChange } from '../../domain/memory-repository.ts';
import type { MemoryChange, MemoryRule } from '../../domain/memory.ts';

type RuleRow = { id: number; user_id: number; text: string; updated_at: string; deleted_at: string | null };

type ChangeRow = {
  id: number;
  user_id: number;
  rule_id: number;
  operation: MemoryOperation;
  before_text: string | null;
  after_text: string | null;
  source: 'remark' | 'user';
  conversation_id: string | null;
  message_id: string | null;
  undone_at: string | null;
};

const RULE_COLUMNS = ['id', 'user_id', 'text', 'updated_at', 'deleted_at'] as const;

export class SqliteMemoryRepository implements MemoryRepository {
  readonly #database: Knex;

  constructor(database: Knex) {
    this.#database = database;
  }

  async activeRules(userId: number): Promise<MemoryRule[]> {
    const rows: RuleRow[] = await this.#database('memory_rules')
      .where({ user_id: userId })
      .whereNull('deleted_at')
      .select(RULE_COLUMNS)
      .orderBy('id');
    return rows.map(toRule);
  }

  async findRule(id: number): Promise<MemoryRule | null> {
    const row: RuleRow | undefined = await this.#database('memory_rules').where({ id }).first(RULE_COLUMNS);
    return row ? toRule(row) : null;
  }

  async addRule(userId: number, text: string, now: Date): Promise<MemoryRule> {
    const at = now.toISOString();
    const [id] = await this.#database('memory_rules').insert({ user_id: userId, text, created_at: at, updated_at: at });
    return { id: id!, userId, text, updatedAt: now, deletedAt: null };
  }

  async rewriteRule(id: number, text: string, now: Date): Promise<void> {
    await this.#database('memory_rules').where({ id }).update({ text, updated_at: now.toISOString() });
  }

  async forgetRule(id: number, now: Date): Promise<void> {
    await this.#database('memory_rules').where({ id }).update({ deleted_at: now.toISOString() });
  }

  async restoreRule(id: number, now: Date): Promise<void> {
    await this.#database('memory_rules').where({ id }).update({ deleted_at: null, updated_at: now.toISOString() });
  }

  async recordChange(change: NewMemoryChange, now: Date): Promise<MemoryChange> {
    const [id] = await this.#database('memory_rule_changes').insert({
      user_id: change.userId,
      rule_id: change.ruleId,
      operation: change.operation,
      before_text: change.before,
      after_text: change.after,
      source: change.source,
      conversation_id: change.conversationId,
      message_id: change.messageId,
      created_at: now.toISOString(),
    });
    return { ...change, id: id!, undoneAt: null };
  }

  async findChange(id: number): Promise<MemoryChange | null> {
    const row: ChangeRow | undefined = await this.#database('memory_rule_changes').where({ id }).first();
    return row ? toChange(row) : null;
  }

  async markUndone(changeId: number, now: Date): Promise<void> {
    await this.#database('memory_rule_changes').where({ id: changeId }).update({ undone_at: now.toISOString() });
  }
}

function toRule(row: RuleRow): MemoryRule {
  return {
    id: row.id,
    userId: row.user_id,
    text: row.text,
    updatedAt: new Date(row.updated_at),
    deletedAt: row.deleted_at ? new Date(row.deleted_at) : null,
  };
}

function toChange(row: ChangeRow): MemoryChange {
  return {
    id: row.id,
    userId: row.user_id,
    ruleId: row.rule_id,
    operation: row.operation,
    before: row.before_text,
    after: row.after_text,
    source: row.source,
    conversationId: row.conversation_id,
    messageId: row.message_id,
    undoneAt: row.undone_at ? new Date(row.undone_at) : null,
  };
}
