import { MAX_MEMORY_RULES } from '@open-agent/shared';
import { generateText, Output } from 'ai';
import { z } from 'zod';

import type { MemoryRule } from '../domain/memory.ts';
import type { User } from '../domain/user.ts';
import type { MemoryEdit } from './memory.ts';
import type { Models } from './models.ts';
import type { Settings } from './settings.ts';
import type { UsageRecorder } from './usage-recorder.ts';

const schema = z.object({
  operation: z.enum(['add', 'update', 'delete', 'none']),
  ruleId: z.number().nullable(),
  text: z.string().nullable(),
});

/**
 * Turns a remark into one edit of the user's rules, on the background model. It sees every rule, so a remark that
 * contradicts or refines one rewrites it instead of adding a second, conflicting rule.
 */
export class MemoryReconciler {
  readonly #models: Models;
  readonly #usage: UsageRecorder;
  readonly #settings: Settings;

  constructor(models: Models, usage: UsageRecorder, settings: Settings) {
    this.#models = models;
    this.#usage = usage;
    this.#settings = settings;
  }

  /** `null`: nothing to change, or the model's answer does not hold (an unknown rule, a missing text). */
  async reconcile(
    user: User,
    conversationId: string,
    remark: string,
    rules: readonly MemoryRule[],
    abortSignal: AbortSignal,
  ): Promise<MemoryEdit | null> {
    const choice = this.#models.choose('background', user);
    const result = await generateText({
      model: choice.model,
      output: Output.object({ schema }),
      // A full memory takes no new rule: said to the model, and enforced by `Memory.applyRemark`.
      instructions:
        rules.length >= MAX_MEMORY_RULES
          ? `${this.#settings.prompt('memory')}\n\nThe list is full: "add" is not allowed; update the closest rule or answer "none".`
          : this.#settings.prompt('memory'),
      prompt: [
        `Remark: ${remark}`,
        '',
        'Current rules:',
        ...(rules.length > 0 ? rules.map((rule) => `${rule.id}: ${rule.text}`) : ['(none)']),
      ].join('\n'),
      maxOutputTokens: 300,
      abortSignal,
    });
    await this.#usage.record(user, conversationId, 'memory', choice, result.usage, result.providerMetadata);

    const { operation, ruleId, text } = result.output;
    const known = rules.some((rule) => rule.id === ruleId);
    if (operation === 'add' && text) return { operation, text };
    if (operation === 'update' && known && text) return { operation, ruleId: ruleId!, text };
    if (operation === 'delete' && known) return { operation, ruleId: ruleId! };
    return null;
  }
}
