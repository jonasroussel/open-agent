import type { Knex } from 'knex';

import type { UsageEvent, UsageLedger } from '../../domain/usage.ts';

export class SqliteUsageLedger implements UsageLedger {
  readonly #database: Knex;

  constructor(database: Knex) {
    this.#database = database;
  }

  async record(event: UsageEvent): Promise<void> {
    await this.#database('usage_events').insert({
      user_id: event.userId,
      conversation_id: event.conversationId,
      purpose: event.purpose,
      model: event.model,
      input_tokens: event.inputTokens,
      output_tokens: event.outputTokens,
      reasoning_tokens: event.reasoningTokens,
      cost_usd: event.costUsd,
      paid_by_user: event.paidByUser,
      created_at: event.at.toISOString(),
    });
  }

  async spentSince(userId: number, since: Date): Promise<number> {
    const row = await this.#database('usage_events')
      .where({ user_id: userId, paid_by_user: false })
      .andWhere('created_at', '>=', since.toISOString())
      .sum({ spent: 'cost_usd' })
      .first();
    return Number(row?.spent ?? 0);
  }

  async spentByUserSince(since: Date): Promise<Map<number, number>> {
    const rows: { user_id: number; spent: number | null }[] = await this.#database('usage_events')
      .where({ paid_by_user: false })
      .andWhere('created_at', '>=', since.toISOString())
      .groupBy('user_id')
      .select('user_id')
      .sum({ spent: 'cost_usd' });
    return new Map(rows.map((row) => [row.user_id, Number(row.spent ?? 0)]));
  }
}
