import type { ChatMessageMetadata, DocumentToolOutput, MemoryNotice, WebSearchOutput } from '@open-agent/shared';
import {
  convertToModelMessages,
  createUIMessageStream,
  generateText,
  isStepCount,
  Output,
  safeValidateUIMessages,
  streamText,
  tool,
  toUIMessageStream,
  type InferUIMessageChunk,
  type UIMessageChunk,
} from 'ai';
import { z } from 'zod';

import type { Artifact } from '../domain/artifact.ts';
import type { ConversationRepository } from '../domain/conversation-repository.ts';
import { cleanIcon, cleanTitle, type ChatMessage, type Conversation } from '../domain/conversation.ts';
import { attachedNames, attachmentsAreValid } from '../domain/library-file.ts';
import type { MemoryRule } from '../domain/memory.ts';
import { isExhausted } from '../domain/quota.ts';
import type { User } from '../domain/user.ts';
import type { Artifacts } from './artifacts.ts';
import type { Library } from './library.ts';
import type { MemoryReconciler } from './memory-reconciler.ts';
import type { Memory } from './memory.ts';
import type { Models } from './models.ts';
import type { Clock } from './ports/clock.ts';
import { ModelUnavailableError } from './ports/model-catalog.ts';
import type { WebSearch } from './ports/web-search.ts';
import { textOf, type PreAnalysis } from './pre-analysis.ts';
import type { Quotas } from './quotas.ts';
import type { Settings } from './settings.ts';
import type { UsageRecorder } from './usage-recorder.ts';

/** The memory notices the client sends back with the history: checked like every other part. */
const dataSchemas = {
  memory: z.object({
    changeId: z.number(),
    operation: z.enum(['add', 'update', 'delete']),
    before: z.string().nullable(),
    after: z.string().nullable(),
    undone: z.boolean(),
  }),
};

/** Ids come from the client (`crypto.randomUUID()`); anything else is refused before reaching the database. */
const CONVERSATION_ID = /^[\w-]{8,64}$/;

/** Two searches, a document, then the answer: the last step may not use tools. */
const MAX_STEPS = 4;
/** What the model reads of each page found: enough to answer, few tokens. */
const RESULT_CHARACTERS = 1500;

export type ChatTurnResult =
  | { ok: true; stream: ReadableStream<UIMessageChunk<ChatMessageMetadata>> }
  | { ok: false; reason: 'invalid_request' | 'not_found' | 'model_unavailable' | 'quota_exceeded' };

/**
 * One exchange: the client sends the whole history (its last message is the user's). The pre-analysis picks how to
 * answer; the answer streams back and the history with it is saved when the stream ends, even when the user stops it.
 * A remark about how the assistant should work becomes a rule meanwhile, shown under the answer. A new conversation
 * is named in parallel, from its first message.
 */
export class ChatTurns {
  readonly #conversations: ConversationRepository;
  readonly #preAnalysis: PreAnalysis;
  readonly #memory: Memory;
  readonly #reconciler: MemoryReconciler;
  readonly #usage: UsageRecorder;
  readonly #quotas: Quotas;
  readonly #library: Library;
  readonly #artifacts: Artifacts;
  readonly #models: Models;
  readonly #settings: Settings;
  readonly #clock: Clock;
  readonly #webSearch: WebSearch | null;

  constructor(
    conversations: ConversationRepository,
    preAnalysis: PreAnalysis,
    memory: Memory,
    reconciler: MemoryReconciler,
    usage: UsageRecorder,
    quotas: Quotas,
    library: Library,
    artifacts: Artifacts,
    models: Models,
    settings: Settings,
    clock: Clock,
    webSearch: WebSearch | null,
  ) {
    this.#conversations = conversations;
    this.#preAnalysis = preAnalysis;
    this.#memory = memory;
    this.#reconciler = reconciler;
    this.#usage = usage;
    this.#quotas = quotas;
    this.#library = library;
    this.#artifacts = artifacts;
    this.#models = models;
    this.#settings = settings;
    this.#clock = clock;
    this.#webSearch = webSearch;
  }

  async start(user: User, id: unknown, rawMessages: unknown, abortSignal: AbortSignal): Promise<ChatTurnResult> {
    if (typeof id !== 'string' || !CONVERSATION_ID.test(id)) return { ok: false, reason: 'invalid_request' };
    const validated = await safeValidateUIMessages<ChatMessage>({ messages: rawMessages, dataSchemas });
    if (!validated.success || validated.data.at(-1)?.role !== 'user') return { ok: false, reason: 'invalid_request' };
    const messages = validated.data;
    if (!attachmentsAreValid(messages)) return { ok: false, reason: 'invalid_request' };

    try {
      this.#models.choose('fast');
    } catch (error) {
      if (error instanceof ModelUnavailableError) return { ok: false, reason: 'model_unavailable' };
      throw error;
    }
    if (isExhausted(await this.#quotas.of(user))) return { ok: false, reason: 'quota_exceeded' };

    const now = this.#clock.now();
    const existing = await this.#conversations.find(id);
    if (existing && existing.userId !== user.id) return { ok: false, reason: 'not_found' };
    const conversation = existing ?? (await this.#conversations.create({ id, userId: user.id, now }));
    // Conversations from before icons get theirs at their next message; a title, maybe renamed by the user, stays.
    if (!conversation.title || !conversation.icon) void this.#name(user, conversation, messages[0]!);

    const stream = createUIMessageStream<ChatMessage>({
      originalMessages: messages,
      onEnd: async ({ messages: history }) => {
        await this.#conversations.replaceMessages(conversation.id, history, this.#clock.now());
      },
      onError: (error) => {
        console.error('Answer failed:', error);
        return 'The answer failed.';
      },
      execute: async ({ writer }) => {
        const rules = await this.#memory.rules(user);
        const analysis = await this.#preAnalysis.analyze(user, conversation.id, messages, rules, abortSignal);
        const messageId = crypto.randomUUID();
        const remembering = analysis.feedback
          ? this.#remember(user, analysis.feedback, rules, { conversationId: conversation.id, messageId }, abortSignal)
          : Promise.resolve(null);

        if (analysis.clarifyingQuestion) {
          writer.write({ type: 'start', messageId, messageMetadata: { route: 'clarify' } });
          writer.write({ type: 'text-start', id: messageId });
          writer.write({ type: 'text-delta', id: messageId, delta: analysis.clarifyingQuestion });
          writer.write({ type: 'text-end', id: messageId });
        } else {
          const metadata: ChatMessageMetadata = { route: analysis.route };
          if (analysis.rewrittenRequest) metadata.rewrittenRequest = analysis.rewrittenRequest;
          // Sent first: the badge "Deep thinking" shows while the model thinks.
          writer.write({ type: 'start', messageId, messageMetadata: metadata });

          const choice = this.#models.choose(analysis.route);
          const documents = await this.#artifacts.latestOf(conversation.id);
          const tools = {
            ...this.#documentTools(user, conversation.id),
            ...(this.#webSearch
              ? { web_search: this.#searchTool(user, conversation.id, this.#webSearch, abortSignal) }
              : {}),
          };
          const searchFirst = this.#webSearch !== null && analysis.webSearch;
          const result = streamText({
            model: choice.model,
            instructions: instructions(
              this.#settings.prompt('assistant'),
              user,
              rules,
              this.#clock.now(),
              this.#webSearch !== null,
              documents,
            ),
            // Every attached file goes in whole, at each answer: the user may ask about any detail, any time.
            messages: await convertToModelMessages(
              await this.#library.expandFiles(
                user,
                withoutDocumentBodies(withLatestRequest(messages, analysis.rewrittenRequest)),
              ),
            ),
            tools,
            stopWhen: isStepCount(MAX_STEPS),
            prepareStep: ({ stepNumber }) => {
              if (stepNumber === 0 && searchFirst) return { toolChoice: 'required', activeTools: ['web_search'] };
              if (stepNumber === MAX_STEPS - 1) return { toolChoice: 'none' };
              return undefined;
            },
            abortSignal,
            // Each step is one billed call: a search, a document, then the answer.
            onStepEnd: (step) =>
              this.#usage.record(user, conversation.id, 'answer', choice, step.usage, step.providerMetadata),
          });
          // Relayed chunk by chunk, so the memory notice lands before the end of the message.
          for await (const chunk of toUIMessageStream({
            stream: result.stream,
            sendStart: false,
            sendFinish: false,
          })) {
            // The model's stream has text, reasoning and our tools' parts, never data parts: it fits our message type.
            writer.write(chunk as InferUIMessageChunk<ChatMessage>);
          }
        }

        const notice = await remembering;
        if (notice) writer.write({ type: 'data-memory', id: `memory-${notice.changeId}`, data: notice });
        writer.write({ type: 'finish' });
      },
    });
    return { ok: true, stream };
  }

  /** Never fails the turn: a remark that could not be remembered still gets its answer. */
  async #remember(
    user: User,
    remark: string,
    rules: readonly MemoryRule[],
    source: { conversationId: string; messageId: string },
    abortSignal: AbortSignal,
  ): Promise<MemoryNotice | null> {
    try {
      const edit = await this.#reconciler.reconcile(user, source.conversationId, remark, rules, abortSignal);
      return edit ? await this.#memory.applyRemark(user, edit, source) : null;
    } catch (error) {
      console.error('Remembering a remark failed:', error);
      return null;
    }
  }

  /** A failed search reaches the model as an error: it answers without, and says so. */
  #searchTool(user: User, conversationId: string, webSearch: WebSearch, abortSignal: AbortSignal) {
    return tool({
      description:
        'Search the web. Returns the most relevant pages, each with its title, link, an extract and its date when known.',
      inputSchema: z.object({
        query: z
          .string()
          .min(1)
          .max(300)
          .describe("What to type in a search engine, in the user's language, with the place when it matters."),
        recent: z.boolean().describe('True to keep only pages from the last few days: news, prices, events.'),
      }),
      execute: async ({ query, recent }): Promise<WebSearchOutput> => {
        const found = await webSearch.search({ query, recent, locale: user.locale }, abortSignal);
        await this.#usage.recordSearch(user, conversationId, found.provider);
        return {
          results: found.results.map((result) => ({ ...result, content: result.content.slice(0, RESULT_CHARACTERS) })),
        };
      },
    });
  }

  /** The canvas. A refused write (too long, unknown document) reaches the model as an error it can fix. */
  #documentTools(user: User, conversationId: string) {
    return {
      create_document: tool({
        description:
          'Create a document in the canvas, a panel next to the conversation where the user reads it, edits it by hand, prints it or downloads it as Word or PDF.',
        inputSchema: z.object({
          kind: z
            .enum(['document', 'html'])
            .describe(
              '"document": Markdown text. "html": a complete page (<!doctype html>…) with its CSS and JavaScript inline and no outside files, shown live: games, cards, calculators.',
            ),
          title: z.string().min(1).max(120).describe("A short title, in the user's language."),
          content: z.string().min(1).describe('The whole content.'),
        }),
        execute: async (input) => toolOutput(await this.#artifacts.create(user, conversationId, input)),
      }),
      update_document: tool({
        description:
          "Rewrite a document of the canvas with the requested changes, keeping everything else exactly as it is, the user's own edits included. Give its whole new content.",
        inputSchema: z.object({
          id: z.string().describe('The id of the document, from the list in the instructions.'),
          content: z.string().min(1).describe('The whole new content.'),
        }),
        execute: async ({ id, content }) => toolOutput(await this.#artifacts.rewrite(conversationId, id, content)),
      }),
    };
  }

  /**
   * A title and an icon, from the first message. Never fails the turn: without them the sidebar shows "New
   * conversation" and the default icon.
   */
  async #name(user: User, conversation: Conversation, first: ChatMessage): Promise<void> {
    // A first message may be only a photo or a document: its name is enough to name the conversation.
    const text = textOf(first) || attachedNames(first);
    if (!text) return;
    try {
      const choice = this.#models.choose('background');
      const result = await generateText({
        model: choice.model,
        output: Output.object({ schema: z.object({ title: z.string(), icon: z.string() }) }),
        prompt: `Name a conversation that starts with the message below. Answer with JSON only: {"title", "icon"}.\n- title: a short title (at most 6 words), in the message's language, without quotes.\n- icon: the name of one Lucide icon (lucide.dev, kebab-case, e.g. "fuel", "utensils", "file-text") that best shows the topic.\n\nMessage:\n${text.slice(0, 2000)}`,
        maxOutputTokens: 60,
      });
      await this.#usage.record(user, conversation.id, 'title', choice, result.usage, result.providerMetadata);
      const title = cleanTitle(result.output.title);
      // A malformed name gets the default icon, so the next messages do not ask again.
      const icon = cleanIcon(result.output.icon) ?? 'message-square';
      if (title && !conversation.title) await this.#conversations.rename(conversation.id, title);
      await this.#conversations.setIcon(conversation.id, icon);
    } catch (error) {
      console.error('Naming a conversation failed:', error);
    }
  }
}

/** What the model and the chat's card learn of a written document. */
function toolOutput(artifact: Artifact): DocumentToolOutput {
  return { id: artifact.id, kind: artifact.kind, title: artifact.title, version: artifact.version };
}

/** The model answers the clearer request; the conversation keeps the user's own words. Files stay attached. */
function withLatestRequest(messages: ChatMessage[], rewrittenRequest: string | null): ChatMessage[] {
  if (!rewrittenRequest) return messages;
  const latest = messages.at(-1)!;
  const parts = [
    { type: 'text' as const, text: rewrittenRequest },
    ...latest.parts.filter((part) => part.type !== 'text'),
  ];
  return [...messages.slice(0, -1), { ...latest, parts }];
}

/**
 * Past versions written by the tools stay out of the model's history: the instructions hold the latest one of each
 * document, so a long document is not paid for again at every version.
 */
function withoutDocumentBodies(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((message) => ({
    ...message,
    parts: message.parts.map((part) =>
      (part.type === 'tool-create_document' || part.type === 'tool-update_document') && part.input
        ? ({
            ...part,
            input: { ...part.input, content: '(See the latest version in the instructions.)' },
          } as typeof part)
        : part,
    ),
  }));
}

/**
 * The admin's assistant prompt (`DEFAULT_PROMPTS.assistant` until changed), then what only the code knows: the date,
 * the app's language, whether the web can be searched, the canvas documents and the user's rules. The rules come
 * last, so they win over the general style.
 */
function instructions(
  prompt: string,
  user: User,
  rules: readonly MemoryRule[],
  now: Date,
  canSearch: boolean,
  documents: readonly { artifact: Artifact; content: string }[],
): string {
  const today = new Intl.DateTimeFormat('en-GB', { dateStyle: 'full', timeZone: 'Europe/Paris' }).format(now);
  return [
    prompt,
    '',
    `Today is ${today}. The user's app is set to ${user.locale === 'fr' ? 'French' : 'English'}.`,
    ...(canSearch ? [] : ['The web search is not available right now: say so when an answer needs current facts.']),
    ...(documents.length > 0
      ? [
          '',
          "Documents in this conversation's canvas, latest versions (the user may have edited them by hand):",
          ...documents.map(
            ({ artifact, content }) =>
              `<document id="${artifact.id}" kind="${artifact.kind}" title="${artifact.title.replaceAll('"', "'")}" version="${artifact.version}">\n${content}\n</document>`,
          ),
        ]
      : []),
    ...(rules.length > 0
      ? [
          '',
          "The user's preferences, learned from their remarks. Follow them, unless their latest message asks otherwise:",
          ...rules.map((rule) => `- ${rule.text}`),
        ]
      : []),
  ].join('\n');
}
