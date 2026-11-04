import type { Knex } from 'knex';

import type { CommandRepository } from '../../domain/command-repository.ts';
import type { Command } from '../../domain/command.ts';

type CommandRow = {
  id: string;
  user_id: number;
  name: string;
  prompt: string;
  uses: number;
  position: number;
  created_at: string;
  updated_at: string;
};

export class SqliteCommandRepository implements CommandRepository {
  readonly #database: Knex;

  constructor(database: Knex) {
    this.#database = database;
  }

  async listOf(userId: number): Promise<Command[]> {
    const rows: CommandRow[] = await this.#database('commands')
      .where({ user_id: userId })
      .orderBy([{ column: 'position' }, { column: 'created_at', order: 'desc' }]);
    return rows.map(toCommand);
  }

  async find(userId: number, id: string): Promise<Command | null> {
    const row: CommandRow | undefined = await this.#database('commands').where({ id, user_id: userId }).first();
    return row ? toCommand(row) : null;
  }

  async findByName(userId: number, name: string): Promise<Command | null> {
    const row: CommandRow | undefined = await this.#database('commands').where({ user_id: userId, name }).first();
    return row ? toCommand(row) : null;
  }

  async create(command: Command): Promise<void> {
    await this.#database('commands').insert({
      id: command.id,
      user_id: command.userId,
      name: command.name,
      prompt: command.prompt,
      uses: command.uses,
      position: command.position,
      created_at: command.createdAt.toISOString(),
      updated_at: command.updatedAt.toISOString(),
    });
  }

  async update(id: string, name: string, prompt: string, now: Date): Promise<void> {
    await this.#database('commands').where({ id }).update({ name, prompt, updated_at: now.toISOString() });
  }

  async delete(id: string): Promise<void> {
    await this.#database('commands').where({ id }).delete();
  }

  async recordUse(id: string): Promise<void> {
    await this.#database('commands').where({ id }).increment('uses', 1);
  }

  async reorder(userId: number, ids: readonly string[]): Promise<void> {
    await this.#database.transaction(async (transaction) => {
      for (const [position, id] of ids.entries()) {
        await transaction('commands').where({ id, user_id: userId }).update({ position });
      }
    });
  }
}

function toCommand(row: CommandRow): Command {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    prompt: row.prompt,
    uses: row.uses,
    position: row.position,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}
