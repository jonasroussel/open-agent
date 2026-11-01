import { MAX_MEMORY_RULE_LENGTH, type MemoryOperation } from '@open-agent/shared';

/** A lasting preference of a user about how the assistant works, followed in every answer. */
export type MemoryRule = {
  id: number;
  userId: number;
  text: string;
  updatedAt: Date;
  /** Forgotten; kept so an undo brings the same rule back. */
  deletedAt: Date | null;
};

/** One change of one rule. `remark`: made by the assistant from something the user said; `user`: the memory page. */
export type MemoryChange = {
  id: number;
  userId: number;
  ruleId: number;
  operation: MemoryOperation;
  before: string | null;
  after: string | null;
  source: 'remark' | 'user';
  conversationId: string | null;
  messageId: string | null;
  undoneAt: Date | null;
};

/** One line, trimmed; `null` when empty or longer than a rule may be. */
export function cleanRuleText(raw: string): string | null {
  const text = raw.replace(/\s+/g, ' ').trim();
  return text && text.length <= MAX_MEMORY_RULE_LENGTH ? text : null;
}

/**
 * A change can be undone once, and only while the rule is still as the change left it: undoing an older change would
 * silently drop what happened to the rule since.
 */
export function canUndo(change: MemoryChange, rule: MemoryRule): boolean {
  if (change.undoneAt) return false;
  if (change.operation === 'delete') return rule.deletedAt !== null;
  return rule.deletedAt === null && rule.text === change.after;
}
