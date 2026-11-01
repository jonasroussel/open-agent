import { generateText, Output } from 'ai';
import { z } from 'zod';

import { mayAskToClarify, type ChatMessage } from '../domain/conversation.ts';
import { attachedNames } from '../domain/library-file.ts';
import type { MemoryRule } from '../domain/memory.ts';
import type { User } from '../domain/user.ts';
import type { Models } from './models.ts';
import type { Settings } from './settings.ts';
import type { UsageRecorder } from './usage-recorder.ts';

export type Analysis = {
  route: 'fast' | 'reasoning';
  /** One short question back, instead of an answer; only when a guess would waste the user's time. */
  clarifyingQuestion: string | null;
  /** The same request, clearer, for the model; the user's own words stay in the conversation. */
  rewrittenRequest: string | null;
  /** A lasting preference about how the assistant works, from the latest message; the memory records it. */
  feedback: string | null;
  /** The answer must start with a web search: the request needs current or local facts. */
  webSearch: boolean;
};

/** When the pre-analysis fails, the user still gets an answer: the quick one, to their own words. */
const PLAIN: Analysis = {
  route: 'fast',
  clarifyingQuestion: null,
  rewrittenRequest: null,
  feedback: null,
  webSearch: false,
};

/** The rules live in `instructions`: OpenRouter does not show the schema's descriptions to the model (2026-11-01). */
const schema = z.object({
  route: z.enum(['fast', 'reasoning']),
  clarifyingQuestion: z.string().nullable(),
  rewrittenRequest: z.string().nullable(),
  feedback: z.string().nullable(),
  webSearch: z.boolean(),
});

/** Earlier messages give context; long ones are cut, the pre-analysis must stay quick and cheap. */
const CONTEXT_MESSAGES = 6;
const CONTEXT_CHARACTERS = 1200;
const LATEST_CHARACTERS = 6000;

/**
 * One quick call before each answer, on the background model: which model should answer, and whether to ask a
 * question first or to answer a clearer version of the request.
 */
export class PreAnalysis {
  readonly #models: Models;
  readonly #usage: UsageRecorder;
  readonly #settings: Settings;

  constructor(models: Models, usage: UsageRecorder, settings: Settings) {
    this.#models = models;
    this.#usage = usage;
    this.#settings = settings;
  }

  async analyze(
    user: User,
    conversationId: string,
    history: readonly ChatMessage[],
    rules: readonly MemoryRule[],
    abortSignal: AbortSignal,
  ): Promise<Analysis> {
    const mayClarify = mayAskToClarify(history);
    try {
      const choice = this.#models.choose('background', user);
      const result = await generateText({
        model: choice.model,
        output: Output.object({ schema }),
        // Right after a question, the next turn answers: said to the model, and enforced below whatever it says.
        instructions: mayClarify
          ? this.#settings.prompt('preAnalysis')
          : `${this.#settings.prompt('preAnalysis')}\n\nThe assistant just asked the user a question: clarifyingQuestion must be null now.`,
        prompt: transcript(history, rules),
        maxOutputTokens: 500,
        abortSignal,
      });
      await this.#usage.record(user, conversationId, 'pre_pass', choice, result.usage, result.providerMetadata);
      const { route, clarifyingQuestion, rewrittenRequest, feedback, webSearch } = result.output;
      const question = mayClarify ? clarifyingQuestion?.trim() || null : null;
      return {
        route,
        clarifyingQuestion: question,
        rewrittenRequest: question ? null : rewrittenRequest?.trim() || null,
        feedback: feedback?.trim() || null,
        webSearch: !question && webSearch,
      };
    } catch (error) {
      if (abortSignal.aborted) throw error;
      console.error('Pre-analysis failed, answering plainly:', error);
      return PLAIN;
    }
  }
}

function transcript(history: readonly ChatMessage[], rules: readonly MemoryRule[]): string {
  const latest = history.at(-1)!;
  const earlier = history.slice(0, -1).slice(-CONTEXT_MESSAGES);
  const lines = earlier.map(
    (message) =>
      `${message.role === 'user' ? 'User' : 'Assistant'}: ${cut(textOf(message), CONTEXT_CHARACTERS)}${attachments(message)}`,
  );
  return [
    ...(rules.length > 0 ? ["The user's preferences:", ...rules.map((rule) => `- ${rule.text}`), ''] : []),
    ...(lines.length > 0 ? ['Conversation so far:', ...lines, ''] : []),
    'Latest user message:',
    `${cut(textOf(latest), LATEST_CHARACTERS)}${attachments(latest)}`,
  ].join('\n');
}

function attachments(message: ChatMessage): string {
  const names = attachedNames(message);
  return names ? ` [Attached: ${names}]` : '';
}

export function textOf(message: ChatMessage): string {
  return message.parts
    .flatMap((part) => (part.type === 'text' ? [part.text] : []))
    .join('\n')
    .trim();
}

function cut(text: string, length: number): string {
  return text.length > length ? `${text.slice(0, length)}…` : text;
}
