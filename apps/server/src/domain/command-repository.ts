import type { Command } from './command.ts';

export interface CommandRepository {
  /** Most used first, then by name. */
  listOf(userId: number): Promise<Command[]>;
  /** Only the user's own. */
  find(userId: number, id: string): Promise<Command | null>;
  findByName(userId: number, name: string): Promise<Command | null>;
  create(command: Command): Promise<void>;
  update(id: string, name: string, prompt: string, now: Date): Promise<void>;
  delete(id: string): Promise<void>;
  recordUse(id: string): Promise<void>;
}
