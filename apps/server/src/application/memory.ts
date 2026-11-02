import { MAX_MEMORY_RULES, type MemoryNotice } from '@open-agent/shared';

import type { ConversationRepository } from '../domain/conversation-repository.ts';
import type { MemoryRepository } from '../domain/memory-repository.ts';
import { canUndo, cleanRuleText, type MemoryChange, type MemoryRule } from '../domain/memory.ts';
import type { User } from '../domain/user.ts';
import type { Clock } from './ports/clock.ts';

/** What the reconciler decided to do with a remark. */
export type MemoryEdit =
  | { operation: 'add'; text: string }
  | { operation: 'update'; ruleId: number; text: string }
  | { operation: 'delete'; ruleId: number };

/** Where a remark was made: its notice goes under that answer. */
export type RemarkSource = { conversationId: string; messageId: string };

export type RuleResult =
  | { ok: true; rule: MemoryRule }
  | { ok: false; reason: 'invalid_request' | 'not_found' | 'memory_full' };

/** A user's rules: learned from their remarks in conversations, or written on the memory page. */
export class Memory {
  readonly #memory: MemoryRepository;
  readonly #conversations: ConversationRepository;
  readonly #clock: Clock;

  constructor(memory: MemoryRepository, conversations: ConversationRepository, clock: Clock) {
    this.#memory = memory;
    this.#conversations = conversations;
    this.#clock = clock;
  }

  rules(user: User): Promise<MemoryRule[]> {
    return this.#memory.activeRules(user.id);
  }

  async add(user: User, rawText: string): Promise<RuleResult> {
    const text = cleanRuleText(rawText);
    if (!text) return { ok: false, reason: 'invalid_request' };
    if ((await this.#memory.activeRules(user.id)).length >= MAX_MEMORY_RULES)
      return { ok: false, reason: 'memory_full' };
    const now = this.#clock.now();
    const rule = await this.#memory.addRule(user.id, text, now);
    await this.#record(user, rule.id, 'add', null, text, 'user', null, now);
    return { ok: true, rule };
  }

  async rewrite(user: User, ruleId: number, rawText: string): Promise<RuleResult> {
    const text = cleanRuleText(rawText);
    if (!text) return { ok: false, reason: 'invalid_request' };
    const rule = await this.#active(user, ruleId);
    if (!rule) return { ok: false, reason: 'not_found' };
    const now = this.#clock.now();
    await this.#memory.rewriteRule(rule.id, text, now);
    await this.#record(user, rule.id, 'update', rule.text, text, 'user', null, now);
    return { ok: true, rule: { ...rule, text, updatedAt: now } };
  }

  /** By the user on their memory page, or by the admin repairing a rule the assistant misunderstood. */
  async forget(user: User, ruleId: number, by: 'user' | 'admin' = 'user'): Promise<boolean> {
    const rule = await this.#active(user, ruleId);
    if (!rule) return false;
    const now = this.#clock.now();
    await this.#memory.forgetRule(rule.id, now);
    await this.#record(user, rule.id, 'delete', rule.text, null, by, null, now);
    return true;
  }

  /**
   * Applies what the reconciler decided from a remark, and returns the notice to show. `source`: the answer the notice
   * goes under; `null` when the user asked to remember a message, the notice then only shows beside it. `null` back
   * when the edit does not hold: a rule that is not the user's (or no longer exists), or an addition to a full memory.
   */
  async applyRemark(user: User, edit: MemoryEdit, source: RemarkSource | null): Promise<MemoryNotice | null> {
    const now = this.#clock.now();
    if (edit.operation === 'add') {
      const text = cleanRuleText(edit.text);
      if (!text || (await this.#memory.activeRules(user.id)).length >= MAX_MEMORY_RULES) return null;
      const rule = await this.#memory.addRule(user.id, text, now);
      return toNotice(await this.#record(user, rule.id, 'add', null, text, 'remark', source, now));
    }

    const rule = await this.#active(user, edit.ruleId);
    if (!rule) return null;
    if (edit.operation === 'delete') {
      await this.#memory.forgetRule(rule.id, now);
      return toNotice(await this.#record(user, rule.id, 'delete', rule.text, null, 'remark', source, now));
    }
    const text = cleanRuleText(edit.text);
    if (!text || text === rule.text) return null;
    await this.#memory.rewriteRule(rule.id, text, now);
    return toNotice(await this.#record(user, rule.id, 'update', rule.text, text, 'remark', source, now));
  }

  /** Puts the rule back as it was before the change, and marks the change's notice in its conversation as undone. */
  async undo(
    user: User,
    changeId: number,
  ): Promise<{ ok: true } | { ok: false; reason: 'not_found' | 'memory_changed' }> {
    const change = await this.#memory.findChange(changeId);
    if (change?.userId !== user.id) return { ok: false, reason: 'not_found' };
    const rule = await this.#memory.findRule(change.ruleId);
    if (!rule || !canUndo(change, rule)) return { ok: false, reason: 'memory_changed' };

    const now = this.#clock.now();
    if (change.operation === 'add') await this.#memory.forgetRule(rule.id, now);
    if (change.operation === 'update') await this.#memory.rewriteRule(rule.id, change.before!, now);
    if (change.operation === 'delete') await this.#memory.restoreRule(rule.id, now);
    await this.#memory.markUndone(change.id, now);
    if (change.conversationId && change.messageId) {
      await this.#markNoticeUndone(change.conversationId, change.messageId, change.id);
    }
    return { ok: true };
  }

  async #markNoticeUndone(conversationId: string, messageId: string, changeId: number): Promise<void> {
    const message = await this.#conversations.findMessage(conversationId, messageId);
    if (!message) return;
    const parts = message.parts.map((part) =>
      part.type === 'data-memory' && part.data.changeId === changeId
        ? { ...part, data: { ...part.data, undone: true } }
        : part,
    );
    await this.#conversations.updateMessage(conversationId, { ...message, parts });
  }

  async #active(user: User, ruleId: number): Promise<MemoryRule | null> {
    const rule = await this.#memory.findRule(ruleId);
    return rule && rule.userId === user.id && !rule.deletedAt ? rule : null;
  }

  #record(
    user: User,
    ruleId: number,
    operation: MemoryChange['operation'],
    before: string | null,
    after: string | null,
    origin: MemoryChange['source'],
    source: RemarkSource | null,
    now: Date,
  ): Promise<MemoryChange> {
    return this.#memory.recordChange(
      {
        userId: user.id,
        ruleId,
        operation,
        before,
        after,
        source: origin,
        conversationId: source?.conversationId ?? null,
        messageId: source?.messageId ?? null,
      },
      now,
    );
  }
}

function toNotice(change: MemoryChange): MemoryNotice {
  return {
    changeId: change.id,
    operation: change.operation,
    before: change.before,
    after: change.after,
    undone: false,
  };
}
