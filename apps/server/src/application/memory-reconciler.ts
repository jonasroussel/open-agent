import { MAX_MEMORY_RULES } from '@open-agent/shared';
import { generateText, Output } from 'ai';
import { z } from 'zod';

import type { MemoryRule } from '../domain/memory.ts';
import type { User } from '../domain/user.ts';
import type { MemoryEdit } from './memory.ts';
import type { ModelCatalog } from './ports/model-catalog.ts';
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
  readonly #models: ModelCatalog;
  readonly #usage: UsageRecorder;

  constructor(models: ModelCatalog, usage: UsageRecorder) {
    this.#models = models;
    this.#usage = usage;
  }

  /** `null`: nothing to change, or the model's answer does not hold (an unknown rule, a missing text). */
  async reconcile(
    user: User,
    conversationId: string,
    remark: string,
    rules: readonly MemoryRule[],
    abortSignal: AbortSignal,
  ): Promise<MemoryEdit | null> {
    const choice = this.#models.choose('background');
    const result = await generateText({
      model: choice.model,
      output: Output.object({ schema }),
      instructions: instructions(rules.length >= MAX_MEMORY_RULES),
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

function instructions(full: boolean): string {
  return `You keep the list of a user's lasting preferences about how their assistant works. Given their latest remark and the current rules (each "id: text"), choose exactly one operation. Answer with JSON only: {"operation", "ruleId", "text"}.

- "update" when the remark contradicts, refines or extends an existing rule: ruleId is that rule, text its new wording. A remark opposite to a rule replaces it; never keep both.
- "delete" when the user asks to stop following a rule, with nothing to replace it: ruleId is that rule, text null.
- "add" when the remark is about something no rule covers: ruleId null, text the new rule.${full ? ' The list is full: "add" is not allowed; update the closest rule or answer "none".' : ''}
- "none" when an existing rule already says the same: ruleId and text null.

Write a rule as a short instruction to the assistant, in the user's language, about one preference. Examples: "Réponses courtes, sans longue introduction.", "Vouvoyer l'utilisateur.", "Pas de listes à puces."`;
}
