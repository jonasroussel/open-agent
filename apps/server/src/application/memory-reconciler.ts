import { MAX_MEMORY_RULES } from '@open-agent/shared';
import { generateText, NoObjectGeneratedError, Output } from 'ai';
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

  /**
   * `null`: nothing to change, or the model's answer does not hold (an unknown rule, a missing text). `explicit`: the
   * user asked to remember this message, so what lasts in it is kept.
   */
  async reconcile(
    user: User,
    conversationId: string,
    remark: string,
    rules: readonly MemoryRule[],
    abortSignal: AbortSignal,
    explicit = false,
  ): Promise<MemoryEdit | null> {
    const choice = this.#models.choose('background', user);
    // A full memory takes no new rule: said to the model, and enforced by `Memory.applyRemark`.
    const lines = [
      this.#settings.prompt('memory'),
      ...(explicit
        ? [
            'The user asked to remember this message: keep what lasts in it, a preference or a fact, as one rule. Answer "none" only when a rule already says it, or when nothing in it lasts beyond the current task.',
          ]
        : []),
      ...(rules.length >= MAX_MEMORY_RULES
        ? ['The list is full: "add" is not allowed; update the closest rule or answer "none".']
        : []),
    ];
    try {
      const result = await generateText({
        model: choice.model,
        output: Output.object({ schema }),
        instructions: lines.join('\n\n'),
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
      return editOf(result.output, rules);
    } catch (error) {
      // An answer that did not parse was billed all the same: the quota must see it.
      if (NoObjectGeneratedError.isInstance(error)) {
        await this.#usage.record(user, conversationId, 'memory', choice, error.usage, undefined, error.response?.body);
      }
      throw error;
    }
  }
}

/** `null`: the answer does not hold (an unknown rule, a missing text). */
function editOf(output: z.infer<typeof schema>, rules: readonly MemoryRule[]): MemoryEdit | null {
  const { operation, ruleId, text } = output;
  const known = rules.some((rule) => rule.id === ruleId);
  if (operation === 'add' && text) return { operation, text };
  if (operation === 'update' && known && text) return { operation, ruleId: ruleId!, text };
  if (operation === 'delete' && known) return { operation, ruleId: ruleId! };
  return null;
}
