import {
  OWN_KEY_REFUSED,
  type AskUserOutput,
  type ChatMessageMetadata,
  type DocumentToolOutput,
  type MemoryNotice,
  type WebSearchOutput,
} from '@open-agent/shared';
import {
  APICallError,
  InvalidToolInputError,
  convertToModelMessages,
  createUIMessageStream,
  generateText,
  isStepCount,
  NoObjectGeneratedError,
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
import {
  answersQuestions,
  cleanIcon,
  cleanTitle,
  hasAsked,
  withAnsweredQuestions,
  type ChatMessage,
  type Conversation,
} from '../domain/conversation.ts';
import { attachedNames, attachmentsAreValid } from '../domain/library-file.ts';
import type { MemoryRule } from '../domain/memory.ts';
import { isExhausted } from '../domain/quota.ts';
import { continuedHistory, signedBy, withAuthorNames } from '../domain/sharing.ts';
import { nameOf, personOf, type User } from '../domain/user.ts';
import type { AnsweringNow } from './answering-now.ts';
import type { Artifacts } from './artifacts.ts';
import type { Commands } from './commands.ts';
import type { ContextTools } from './context-tools.ts';
import type { Library } from './library.ts';
import type { MakingTools } from './making-tools.ts';
import type { MemoryReconciler } from './memory-reconciler.ts';
import type { Memory } from './memory.ts';
import type { Models } from './models.ts';
import type { Participants } from './participants.ts';
import type { Clock } from './ports/clock.ts';
import { ToolRefusal } from './ports/context-services.ts';
import { ModelUnavailableError } from './ports/model-catalog.ts';
import type { WebSearch } from './ports/web-search.ts';
import { textOf, type Analysis, type PreAnalysis } from './pre-analysis.ts';
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
    userId: z.number().optional(),
  }),
};

/** Ids come from the client (`crypto.randomUUID()`); anything else is refused before reaching the database. */
const CONVERSATION_ID = /^[\w-]{8,64}$/;

/**
 * Lookups (searches, a page, a file, a calculation), a document, then the answer: the last step may not use tools. Each
 * step sends the whole conversation again, so each tool also has its own cap (`CONTEXT_TOOL_CAPS`, `MAKING_TOOL_CAPS`).
 */
const MAX_STEPS = 6;
/** Past two searches the model answers with what it has: a third one costs without helping. */
const MAX_SEARCHES = 2;
/** What the model reads of each page found: enough to answer, few tokens. */
const RESULT_CHARACTERS = 1500;
/** A refused tool call's message names the fields it missed; the value it quotes may be long. */
const MAX_INVALID_INPUT_CHARACTERS = 800;
const INVALID_INPUT = 'AI_InvalidToolInputError: ';

/** OpenRouter's answers to a key it does not know (401), without credit (402) or disabled (403). */
const KEY_REFUSED: Record<number, true> = { 401: true, 402: true, 403: true };

export type ChatTurnResult =
  | { ok: true; stream: ReadableStream<UIMessageChunk<ChatMessageMetadata>> }
  | {
      ok: false;
      reason:
        | 'invalid_request'
        | 'not_found'
        | 'model_unavailable'
        | 'quota_exceeded'
        | 'conversation_busy'
        | 'conversation_changed';
    };

/**
 * One exchange: the client sends the whole history (its last message is the user's). The pre-analysis picks how to
 * answer; the answer streams back and the history with it is saved when the stream ends, even when the user stops it.
 * A remark about how the assistant should work becomes a rule meanwhile, shown under the answer. A new conversation
 * is named in parallel, from its first message. In a shared conversation, the sender pays, their memory and commands
 * apply, and the others wait for the answer to write.
 */
export class ChatTurns {
  readonly #conversations: ConversationRepository;
  readonly #participants: Participants;
  readonly #answering: AnsweringNow;
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
  readonly #contextTools: ContextTools;
  readonly #makingTools: MakingTools;
  readonly #commands: Commands;

  constructor(
    conversations: ConversationRepository,
    participants: Participants,
    answering: AnsweringNow,
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
    contextTools: ContextTools,
    makingTools: MakingTools,
    commands: Commands,
  ) {
    this.#conversations = conversations;
    this.#participants = participants;
    this.#answering = answering;
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
    this.#contextTools = contextTools;
    this.#makingTools = makingTools;
    this.#commands = commands;
  }

  /**
   * A new message from the user, or their answers to the questions ending the assistant's last message: that message
   * then goes on.
   */
  async start(user: User, id: unknown, rawMessages: unknown, abortSignal: AbortSignal): Promise<ChatTurnResult> {
    if (typeof id !== 'string' || !CONVERSATION_ID.test(id)) return { ok: false, reason: 'invalid_request' };
    const validated = await safeValidateUIMessages<ChatMessage>({ messages: rawMessages, dataSchemas });
    if (!validated.success) return { ok: false, reason: 'invalid_request' };

    const existing = await this.#conversations.find(id);
    const access = existing && (await this.#participants.access(user, id));
    if (existing && !access) return { ok: false, reason: 'not_found' };
    const people = access ? await this.#participants.people(access.conversation) : [user];
    const shared = people.length > 1;
    const sender = personOf(user);
    let messages = validated.data;
    if (access && shared) {
      const continued = continuedHistory(
        await this.#conversations.messages(id),
        messages,
        sender,
        access.conversation.userId,
      );
      if (!continued.ok) {
        return {
          ok: false,
          reason: continued.reason === 'conversation_changed' ? 'conversation_changed' : 'invalid_request',
        };
      }
      messages = continued.messages;
    } else if (messages.length > 0) {
      messages = [...messages.slice(0, -1), signedBy(messages.at(-1)!, sender)];
    }
    const resumed = answersQuestions(messages) ? messages.at(-1)! : null;
    if (!resumed && messages.at(-1)?.role !== 'user') return { ok: false, reason: 'invalid_request' };
    if (!attachmentsAreValid(messages)) return { ok: false, reason: 'invalid_request' };

    try {
      this.#models.choose('fast', user);
    } catch (error) {
      if (error instanceof ModelUnavailableError) return { ok: false, reason: 'model_unavailable' };
      throw error;
    }
    if (isExhausted(await this.#quotas.of(user))) return { ok: false, reason: 'quota_exceeded' };
    if (shared && !this.#answering.take(id, sender)) return { ok: false, reason: 'conversation_busy' };

    try {
      return await this.#answer(user, id, access?.conversation ?? null, people, messages, resumed, abortSignal);
    } catch (error) {
      if (shared) this.#answering.release(id);
      throw error;
    }
  }

  async #answer(
    user: User,
    id: string,
    existing: Conversation | null,
    people: readonly User[],
    messages: ChatMessage[],
    resumed: ChatMessage | null,
    abortSignal: AbortSignal,
  ): Promise<ChatTurnResult> {
    const now = this.#clock.now();
    const conversation = existing ?? (await this.#conversations.create({ id, userId: user.id, now }));
    const shared = people.length > 1;
    if (shared) {
      // The others see the message at once, and that the assistant is answering it.
      await this.#conversations.replaceMessages(conversation.id, messages, now);
      await this.#participants.publish(conversation, { type: 'conversation', id: conversation.id });
      await this.#participants.publish(conversation, { type: 'conversations' });
    }
    // Conversations from before icons get theirs at their next message; a title, maybe renamed by the user, stays.
    // Each command gets its prompt before the user's words: for the pre-analysis, the title and the model, never in
    // the saved conversation, which keeps the badge.
    const expanded = await this.#commands.expand(user, messages);
    if (!resumed) void this.#commands.recordUse(user, messages.at(-1)!);
    if (!conversation.title || !conversation.icon) void this.#name(user, conversation, expanded[0]!);
    const names = new Map(people.map((person) => [person.id, nameOf(person)]));
    const named = (history: ChatMessage[]) => (shared ? withAuthorNames(history, conversation.userId, names) : history);

    const stream = createUIMessageStream<ChatMessage>({
      originalMessages: messages,
      onEnd: async ({ messages: history }) => {
        try {
          await this.#conversations.replaceMessages(conversation.id, history, this.#clock.now());
        } finally {
          if (shared) this.#answering.release(conversation.id);
        }
        await this.#participants.publish(conversation, { type: 'conversation', id: conversation.id });
      },
      onError: (error) => this.#failure(user, error),
      execute: async ({ writer }) => {
        const rules = await this.#memory.rules(user);
        const analysis = await this.#analysis(user, conversation.id, expanded, resumed, rules, abortSignal);
        const messageId = resumed?.id ?? crypto.randomUUID();
        // An answer to a question is a choice, not a remark about how the assistant works.
        const remembering =
          analysis.feedback && !resumed
            ? this.#remember(
                user,
                analysis.feedback,
                rules,
                { conversationId: conversation.id, messageId },
                abortSignal,
              )
            : Promise.resolve(null);

        if (analysis.clarifyingQuestion) {
          // The same question the model would ask with `ask_user`: the user taps an option or types an answer.
          writer.write({ type: 'start', messageId, messageMetadata: { route: 'clarify' } });
          writer.write({ type: 'start-step' });
          writer.write({
            type: 'tool-input-available',
            toolCallId: `ask-${messageId}`,
            toolName: 'ask_user',
            input: { question: analysis.clarifyingQuestion, options: analysis.clarifyingOptions },
          });
          writer.write({ type: 'finish-step' });
        } else {
          const metadata: ChatMessageMetadata = { route: analysis.route };
          if (analysis.rewrittenRequest) metadata.rewrittenRequest = analysis.rewrittenRequest;
          // Sent first: the badge "Deep thinking" shows while the model thinks. A resumed question gets its route.
          writer.write({ type: 'start', messageId, messageMetadata: metadata });

          const choice = this.#models.choose(analysis.route, user);
          const documents = await this.#artifacts.latestOf(conversation.id);
          // Searches spent this turn, counted here because one step may ask for several at once.
          const searches = { count: 0 };
          const tools = {
            ...this.#documentTools(user, conversation.id),
            ...(this.#webSearch
              ? { web_search: this.#searchTool(user, conversation.id, this.#webSearch, abortSignal, searches) }
              : {}),
            ...this.#contextTools.for(user, conversation.id, abortSignal),
            ...this.#makingTools.for(user, conversation.id, abortSignal),
            save_command: this.#commands.toolFor(user),
            ask_user: askTool(resumed !== null && hasAsked(resumed)),
          };
          const withoutSearch = Object.keys(tools).filter((name) => name !== 'web_search') as (keyof typeof tools)[];
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
              await this.#commands.names(user),
              shared ? people.map(nameOf) : null,
            ),
            // Every attached file goes in whole, at each answer: the user may ask about any detail, any time.
            messages: await convertToModelMessages(
              await this.#library.expandFiles(
                people.map((person) => person.id),
                withoutDocumentBodies(
                  withNotes(named(withLatestRequest(withAnsweredQuestions(expanded), analysis.rewrittenRequest)), [
                    timeNote(this.#clock.now()),
                    ...restoreNotes(documents),
                  ]),
                ),
              ),
            ),
            tools,
            stopWhen: isStepCount(MAX_STEPS),
            // The search tool is withheld once two are spent, and the last step writes.
            prepareStep: ({ stepNumber, steps }) => {
              const searched = steps.reduce(
                (count, step) => count + step.toolCalls.filter((call) => call.toolName === 'web_search').length,
                0,
              );
              if (stepNumber === MAX_STEPS - 1) return { toolChoice: 'none' };
              if (searched >= MAX_SEARCHES) return { activeTools: withoutSearch };
              if (stepNumber === 0 && searchFirst) return { toolChoice: 'required', activeTools: ['web_search'] };
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
            onError: (error) => this.#failure(user, error),
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

  /**
   * A new message is analyzed. After a question of the pre-analysis, it runs again, seeing the answer, and cannot ask
   * twice; after the model's own question, its answer goes on as it started.
   */
  async #analysis(
    user: User,
    conversationId: string,
    messages: ChatMessage[],
    resumed: ChatMessage | null,
    rules: readonly MemoryRule[],
    abortSignal: AbortSignal,
  ): Promise<Analysis> {
    if (!resumed || resumed.metadata?.route === 'clarify') {
      return this.#preAnalysis.analyze(user, conversationId, messages, rules, abortSignal);
    }
    return {
      route: resumed.metadata?.route === 'reasoning' ? 'reasoning' : 'fast',
      clarifyingQuestion: null,
      clarifyingOptions: [],
      rewrittenRequest: null,
      feedback: null,
      webSearch: false,
    };
  }

  /**
   * The text of a failure, kept with the answer or the tool call. A tool's refusal is kept as it is, as are the fields a
   * call missed: the model reads them, and again at the next messages. A refused own key gets its own, so the person can
   * fix it.
   */
  #failure(user: User, error: unknown): string {
    if (error instanceof ToolRefusal) return error.message;
    const invalidInput = invalidInputOf(error);
    if (invalidInput) return invalidInput.slice(0, MAX_INVALID_INPUT_CHARACTERS);
    console.error('Answer failed:', error);
    return user.ownKey && APICallError.isInstance(error) && KEY_REFUSED[error.statusCode ?? 0]
      ? OWN_KEY_REFUSED
      : 'The answer failed.';
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
  #searchTool(
    user: User,
    conversationId: string,
    webSearch: WebSearch,
    abortSignal: AbortSignal,
    searches: { count: number },
  ) {
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
        // Asked for in parallel, past the limit: the refusal reaches the model, which answers with what it has.
        if (searches.count >= MAX_SEARCHES) throw new Error('No more searches this turn: answer with those pages.');
        searches.count += 1;
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
    const choice = this.#models.choose('background', user);
    try {
      const result = await generateText({
        model: choice.model,
        output: Output.object({ schema: z.object({ language: z.string(), title: z.string(), icon: z.string() }) }),
        prompt: `Name a conversation that starts with the message below. Answer with JSON only: {"language", "title", "icon"}.\n- language: the language the user writes the message in. A language they ask about, quote or want a translation into is only the topic. When the message is too short to tell, ${user.locale === 'fr' ? 'French' : 'English'}.\n- title: a short title (at most 6 words), in that language, without quotes.\n- icon: the name of one Lucide icon (lucide.dev, kebab-case, e.g. "fuel", "utensils", "file-text") that best shows the topic.\n\nMessage:\n${text.slice(0, 2000)}`,
        maxOutputTokens: 80,
      });
      await this.#usage.record(user, conversation.id, 'title', choice, result.usage, result.providerMetadata);
      const title = cleanTitle(result.output.title);
      // A malformed name gets the default icon, so the next messages do not ask again.
      const icon = cleanIcon(result.output.icon) ?? 'message-square';
      if (title && !conversation.title) await this.#conversations.rename(conversation.id, title);
      await this.#conversations.setIcon(conversation.id, icon);
      await this.#participants.publish(conversation, { type: 'conversations' });
    } catch (error) {
      // A name that did not parse was billed all the same: the quota must see it.
      if (NoObjectGeneratedError.isInstance(error)) {
        await this.#usage.record(user, conversation.id, 'title', choice, error.usage, undefined, error.response?.body);
      }
      console.error('Naming a conversation failed:', error);
    }
  }
}

/** What the model and the chat's card learn of a written document. */
function toolOutput(artifact: Artifact): DocumentToolOutput {
  return { id: artifact.id, kind: artifact.kind, title: artifact.title, version: artifact.version };
}

/**
 * The model answers the clearer request; the conversation keeps the user's own words. Files stay attached. After an
 * answered question, the request is the user message before it.
 */
function withLatestRequest(messages: ChatMessage[], rewrittenRequest: string | null): ChatMessage[] {
  if (!rewrittenRequest) return messages;
  const latestIndex = messages.findLastIndex((message) => message.role === 'user');
  return messages.map((message, index) =>
    index === latestIndex
      ? {
          ...message,
          parts: [
            { type: 'text' as const, text: rewrittenRequest },
            ...message.parts.filter((part) => part.type !== 'text'),
          ],
        }
      : message,
  );
}

/**
 * The date and time, at the start of the user's latest message for the model only: there, it changes nothing before
 * it, so the provider's cache of the instructions and the history stays valid from one message to the next.
 */
function timeNote(now: Date): string {
  const time = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Paris',
  }).format(now);
  return `[Now: ${time}, Paris time.]`;
}

/**
 * A document the user brought back to an older version is said in their latest message: in the instructions alone,
 * the model redid the undone changes it saw asked and confirmed earlier in the history (2026-11-03).
 */
function restoreNotes(documents: readonly { artifact: Artifact; restoredFrom: number | null }[]): string[] {
  return documents.flatMap(({ artifact, restoredFrom }) =>
    restoredFrom
      ? [
          `[Canvas: I brought "${artifact.title}" back to version ${restoredFrom}, on purpose. The changes made to it after that version, earlier in this conversation, are undone: do not redo them unless I ask again.]`,
        ]
      : [],
  );
}

/** Notes for the model only, opening the user's latest message: the conversation keeps the user's own words. */
function withNotes(messages: ChatMessage[], notes: readonly string[]): ChatMessage[] {
  const latestIndex = messages.findLastIndex((message) => message.role === 'user');
  return messages.map((message, index) =>
    index === latestIndex
      ? { ...message, parts: [{ type: 'text' as const, text: notes.join('\n') }, ...message.parts] }
      : message,
  );
}

const askInput = z.object({ question: z.string(), options: z.array(z.string()) });
const ASK_DESCRIPTION =
  'Ask the user one question when you cannot go on without a choice only they can make. Offer 2 to 4 short answers they can tap, or [] when none can be guessed; they may also type their own. Your answer stops until they reply, then goes on. An answer null means you may not ask again in this answer: decide yourself and say what you assumed.';

/**
 * Without `execute`, a call ends the answer until the user replies. Once a question was asked in this answer, the
 * tool answers `null` itself: one round of questions per answer, the model then decides alone.
 */
function askTool(alreadyAsked: boolean) {
  if (!alreadyAsked) return tool({ description: ASK_DESCRIPTION, inputSchema: askInput });
  return tool({
    description: ASK_DESCRIPTION,
    inputSchema: askInput,
    execute: async (): Promise<AskUserOutput> => ({ answer: null }),
  });
}

/**
 * Past versions written by the tools stay out of the model's history: the instructions hold the latest one of each
 * document, so a long document is not paid for again at every version. Their content is dropped, not replaced: a
 * placeholder sentence there was copied by the model as a new version's whole content (2026-11-02).
 */
function withoutDocumentBodies(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((message) => ({
    ...message,
    parts: message.parts.map((part) =>
      (part.type === 'tool-create_document' || part.type === 'tool-update_document') && part.input
        ? ({
            ...part,
            input: Object.fromEntries(Object.entries(part.input).filter(([key]) => key !== 'content')),
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
  documents: readonly { artifact: Artifact; content: string; restoredFrom: number | null }[],
  commandNames: readonly string[],
  /** In a shared conversation, everyone in it, the owner first; `null` otherwise. */
  people: readonly string[] | null,
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
            ({ artifact, content, restoredFrom }) =>
              `<document id="${artifact.id}" kind="${artifact.kind}" title="${artifact.title.replaceAll('"', "'")}" version="${artifact.version}"${restoredFrom ? ` restored-from="${restoredFrom}"` : ''}>\n${content}\n</document>`,
          ),
          ...documents.flatMap(({ artifact, restoredFrom }) =>
            restoredFrom
              ? [
                  `The user brought "${artifact.title}" back to version ${restoredFrom} on purpose: the changes made after it, yours included, were undone. Work from this content, never redo those changes unless the user asks, and do not describe the document as it was before.`,
                ]
              : [],
          ),
        ]
      : []),
    ...(rules.length > 0
      ? [
          '',
          'What you remember about the user, from what they said: preferences to follow unless their latest message asks otherwise, and facts about them to use when they matter:',
          ...rules.map((rule) => `- ${rule.text}`),
        ]
      : []),
    ...(commandNames.length > 0
      ? [
          '',
          `The user's commands, to rewrite with save_command when they ask: ${commandNames.map((name) => `/${name}`).join(', ')}.`,
        ]
      : []),
    ...(people
      ? [
          '',
          `This conversation is shared between ${people.join(', ')}: each user message opens with its writer's name in brackets. You are answering the last one, ${nameOf(user)}: "the user" above and below means them, and what you remember is about them only. Call each person by that name when it helps.`,
        ]
      : []),
  ].join('\n');
}

/**
 * A call its schema refuses reaches `#failure` twice: as the error for the call, then as its text for the call's result
 * (`AI_InvalidToolInputError: Invalid input for tool …`).
 */
function invalidInputOf(error: unknown): string | null {
  if (InvalidToolInputError.isInstance(error)) return error.message;
  if (typeof error === 'string' && error.startsWith(INVALID_INPUT)) return error.slice(INVALID_INPUT.length);
  return null;
}
