import type { Command } from './command.ts';

export interface CommandRepository {
  /** In the user's order. */
  listOf(userId: number): Promise<Command[]>;
  /** Only the user's own. */
  find(userId: number, id: string): Promise<Command | null>;
  findByName(userId: number, name: string): Promise<Command | null>;
  create(command: Command): Promise<void>;
  update(id: string, name: string, prompt: string, now: Date): Promise<void>;
  delete(id: string): Promise<void>;
  recordUse(id: string): Promise<void>;
  /** `ids`: every command of the user, in their new order. */
  reorder(userId: number, ids: readonly string[]): Promise<void>;
}
