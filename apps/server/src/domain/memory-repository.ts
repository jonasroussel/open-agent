import type { MemoryChange, MemoryRule } from './memory.ts';

export type NewMemoryChange = Omit<MemoryChange, 'id' | 'undoneAt'>;

export interface MemoryRepository {
  /** The rules in force, oldest first. */
  activeRules(userId: number): Promise<MemoryRule[]>;
  /** Forgotten ones too. */
  findRule(id: number): Promise<MemoryRule | null>;
  addRule(userId: number, text: string, now: Date): Promise<MemoryRule>;
  rewriteRule(id: number, text: string, now: Date): Promise<void>;
  forgetRule(id: number, now: Date): Promise<void>;
  restoreRule(id: number, now: Date): Promise<void>;
  recordChange(change: NewMemoryChange, now: Date): Promise<MemoryChange>;
  findChange(id: number): Promise<MemoryChange | null>;
  markUndone(changeId: number, now: Date): Promise<void>;
}
