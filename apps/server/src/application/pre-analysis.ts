import { generateText, Output } from 'ai';
import { z } from 'zod';

import { mayAskToClarify, type ChatMessage } from '../domain/conversation.ts';
import { attachedNames } from '../domain/library-file.ts';
import type { MemoryRule } from '../domain/memory.ts';
import type { User } from '../domain/user.ts';
import type { ModelCatalog } from './ports/model-catalog.ts';
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
  readonly #models: ModelCatalog;
  readonly #usage: UsageRecorder;

  constructor(models: ModelCatalog, usage: UsageRecorder) {
    this.#models = models;
    this.#usage = usage;
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
      const choice = this.#models.choose('background');
      const result = await generateText({
        model: choice.model,
        output: Output.object({ schema }),
        instructions: instructions(mayClarify),
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

function instructions(mayClarify: boolean): string {
  return `You decide how an assistant should answer the latest user message. The users are family and friends, many of them not technical. Answer with JSON only: {"route", "clarifyingQuestion", "rewrittenRequest", "feedback", "webSearch"}.

route:
- "reasoning" when a correct answer needs careful step-by-step work: calculations and word problems, logic puzzles, planning with constraints (schedules, budgets, itineraries), comparing options with trade-offs (money, contracts), writing or debugging non-trivial code.
- "fast" for everything else: chatting, thanks, writing or rewriting texts (letters, emails, messages), translations, explanations, advice, simple facts.

clarifyingQuestion: null in most cases.
${
  mayClarify
    ? `- Ask only when the request cannot be done without something only the user knows, so any guess would likely be wrong. Examples: "Cancel my subscription" (which one?), "Answer him" with no message to answer, "Is it a good price?" with no price or item.
- Do not ask when a sensible default exists, when the missing details can be left as placeholders (names, dates in a letter), or when general help is already useful.
- Files the user attached show as [Attached: …]. The assistant reads them in full: never ask what they contain, and treat a short message next to a file ("Ça vous paraît correct ?") as being about that file.
- One short, friendly question, in the user's language, addressing them directly. In French, use « vous », unless the user's preferences say to use « tu ».`
    : '- The assistant just asked the user a question: clarifyingQuestion must be null now.'
}

rewrittenRequest: null in most cases.
- Only for a clear intent written in a hurry (abbreviations, missing words, typos). Example: "lettre resil box stp" becomes "Écris-moi une lettre de résiliation pour ma box internet."
- Write it as the user would, in the first person, in their language. Keep every fact they gave and add none.
- Null when the message is understandable as written, even if long or informal, and always null when you ask a question.

feedback: null in most cases.
- Fill it only when the latest message says how the assistant should behave from now on, beyond the current request: length, tone, format, language, how to address the user, something to always or never do, or the correction of a mistake that could happen again. Examples: "Tes réponses sont toujours trop longues" gives "Préfère des réponses courtes."; "Arrête de me tutoyer" gives "Vouvoyer l'utilisateur."; "Ne me mets plus de listes à puces" gives "Pas de listes à puces."; "Tu peux oublier les réponses courtes, détaille" gives "Préfère des réponses détaillées.".
- Null for requests about the current task only: "Plus courte" or "Enlève le deuxième paragraphe" about the text being written.
- A short preference, in the user's language. The message is still answered normally.

webSearch: whether the answer needs facts from the web.
- true for anything current, local or specific: news and recent events, prices, weather, opening hours, timetables, sport results, rates, laws and rules that change, a given product, business or place, or a fact that may have changed recently.
- false for writing, rewriting, translating, explaining stable knowledge, calculations, general advice and chatting.`;
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
