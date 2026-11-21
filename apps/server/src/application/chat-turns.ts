import { OWN_KEY_REFUSED } from '@open-agent/shared';
import type { ChatMessageMetadata, MemoryNotice } from '@open-agent/shared';
import {
  APICallError,
  InvalidToolInputError,
  convertToModelMessages,
  createUIMessageStream,
  isStepCount,
  safeValidateUIMessages,
  streamText,
  toUIMessageStream,
} from 'ai';
import type { InferUIMessageChunk } from 'ai';
import { z } from 'zod';

import type { ConversationRepository } from '../domain/conversation-repository.ts';
import { answersQuestions, hasAsked, isOutsideHistory, withAnsweredQuestions } from '../domain/conversation.ts';
import type { ChatMessage, Conversation } from '../domain/conversation.ts';
import { attachmentsAreValid } from '../domain/library-file.ts';
import type { MemoryRule } from '../domain/memory.ts';
import { isExhausted } from '../domain/quota.ts';
import { continuedHistory, signedBy, withAuthorNames } from '../domain/sharing.ts';
import { nameOf, personOf } from '../domain/user.ts';
import type { User } from '../domain/user.ts';
import type { AnswerRuns } from './answer-runs.ts';
import type { Artifacts } from './artifacts.ts';
import {
  instructions,
  restoreNotes,
  THOUGHTS_NOTE,
  timeNote,
  withLatestRequest,
  withNotes,
  withoutDocumentBodies,
} from './chat-prompt.ts';
import { askTool, documentTools, MAX_SEARCHES, searchTool } from './chat-tools.ts';
import type { Commands } from './commands.ts';
import type { ContextTools } from './context-tools.ts';
import { ConversationNaming } from './conversation-naming.ts';
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
import type { Analysis, PreAnalysis } from './pre-analysis.ts';
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
/** A refused tool call's message names the fields it missed; the value it quotes may be long. */
const MAX_INVALID_INPUT_CHARACTERS = 800;
const INVALID_INPUT = 'AI_InvalidToolInputError: ';

/** OpenRouter's answers to a key it does not know (401), without credit (402) or disabled (403). */
const KEY_REFUSED: Record<number, true> = { 401: true, 402: true, 403: true };

export type ChatTurnResult =
  | { ok: true; stream: ReadableStream<InferUIMessageChunk<ChatMessage>> }
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

/** What a conversation is created as, by its first message. */
type NewConversation = Pick<Conversation, 'ephemeral' | 'comparedWith' | 'modelId'>;

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
  readonly #runs: AnswerRuns;
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
  readonly #naming: ConversationNaming;

  constructor(
    conversations: ConversationRepository,
    participants: Participants,
    runs: AnswerRuns,
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
    this.#runs = runs;
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
    this.#naming = new ConversationNaming(conversations, participants, models, usage);
  }

  /**
   * A new message from the user, or their answers to the questions ending the assistant's last message: that message
   * then goes on. `ephemeral` and `comparison` only count for a new conversation: it stays what it was created as.
   * The answer is the server's: it goes on to its end whatever the browser does, which follows it with
   * `AnswerRuns.follow`.
   */
  async start(
    user: User,
    id: unknown,
    rawMessages: unknown,
    ephemeral: unknown = false,
    comparison?: unknown,
  ): Promise<ChatTurnResult> {
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
    if (access) {
      const continued = continuedHistory(
        await this.#conversations.messages(id),
        messages,
        sender,
        access.conversation.userId,
        shared,
      );
      if (!continued.ok) {
        return {
          ok: false,
          reason: continued.reason === 'conversation_changed' ? 'conversation_changed' : 'invalid_request',
        };
      }
      messages = continued.messages;
    } else {
      // Nothing saved yet: only the sent message is taken. Earlier ones are the browser's word alone (a first send
      // refused before anything was saved), and a forged one could name someone else's file or document.
      const last = messages.at(-1);
      if (last?.role !== 'user') return { ok: false, reason: 'invalid_request' };
      messages = [signedBy(last, sender)];
    }
    const resumed = answersQuestions(messages) ? messages.at(-1)! : null;
    if (!resumed && messages.at(-1)?.role !== 'user') return { ok: false, reason: 'invalid_request' };
    if (!attachmentsAreValid(messages)) return { ok: false, reason: 'invalid_request' };
    if (!resumed && !(await this.#library.canAttach(user, messages.at(-1)!))) {
      return { ok: false, reason: 'invalid_request' };
    }
    let created: NewConversation = { ephemeral: ephemeral === true, comparedWith: null, modelId: null };
    if (!existing && comparison !== undefined && comparison !== null) {
      const right = await this.#rightThread(user, id, comparison, created.ephemeral);
      if (!right.ok) return right;
      created = right.conversation;
    }

    try {
      this.#models.choose('fast', user);
    } catch (error) {
      if (error instanceof ModelUnavailableError) return { ok: false, reason: 'model_unavailable' };
      throw error;
    }
    if (isExhausted(await this.#quotas.of(user))) return { ok: false, reason: 'quota_exceeded' };
    // One answer at a time in a conversation: two would each answer a history without the other's message, and the
    // last saved would erase the other, even on the same person's two devices.
    const signal = this.#runs.begin(id, sender);
    if (!signal) return { ok: false, reason: 'conversation_busy' };

    try {
      const stream = await this.#answer(user, id, access?.conversation ?? created, people, messages, resumed, signal);
      this.#runs.feed(id, stream);
      return { ok: true, stream: this.#runs.follow(id)! };
    } catch (error) {
      this.#runs.end(id, signal);
      throw error;
    }
  }

  /**
   * The admin's comparison: the new conversation becomes the right thread of `with`, which is theirs, in their history,
   * and has no right thread yet, or does not exist yet (its first message is sent at the same time).
   */
  async #rightThread(
    user: User,
    id: string,
    comparison: unknown,
    ephemeral: boolean,
  ): Promise<
    { ok: true; conversation: NewConversation } | { ok: false; reason: 'invalid_request' | 'model_unavailable' }
  > {
    const refused = { ok: false, reason: 'invalid_request' } as const;
    if (user.role !== 'admin' || ephemeral || typeof comparison !== 'object' || comparison === null) return refused;
    const { with: left, modelId } = comparison as Record<string, unknown>;
    if (typeof left !== 'string' || !CONVERSATION_ID.test(left) || left === id || typeof modelId !== 'string') {
      return refused;
    }
    const existingLeft = await this.#conversations.find(left);
    if (
      existingLeft &&
      (existingLeft.userId !== user.id ||
        isOutsideHistory(existingLeft) ||
        (await this.#conversations.members(left)).length > 0 ||
        (await this.#conversations.rightThreadOf(user.id, left)))
    ) {
      return refused;
    }
    try {
      if (!(await this.#models.comparable(modelId))) return refused;
    } catch (error) {
      console.error('Listing the models failed:', error);
      return { ok: false, reason: 'model_unavailable' };
    }
    return { ok: true, conversation: { ephemeral: false, comparedWith: left, modelId } };
  }

  /**
   * The answer to the user's own message there, from its start, while it is being written: their page came back.
   * `null` when none is (anymore). The others in a shared conversation get the answer once it is saved.
   */
  async follow(
    user: User,
    id: string,
  ): Promise<{ ok: true; stream: ReadableStream<InferUIMessageChunk<ChatMessage>> | null } | { ok: false }> {
    if (!(await this.#participants.access(user, id))) return { ok: false };
    return { ok: true, stream: this.#runs.who(id)?.id === user.id ? this.#runs.follow(id) : null };
  }

  /** The user's Stop: their answer ends as it is, and is saved so. Nobody stops someone else's. */
  async stop(user: User, id: string): Promise<boolean> {
    if (!(await this.#participants.access(user, id))) return false;
    if (this.#runs.who(id)?.id === user.id) this.#runs.stop(id);
    return true;
  }

  async #answer(
    user: User,
    id: string,
    /** A new one: what it is created as. */
    existing: Conversation | NewConversation,
    people: readonly User[],
    messages: ChatMessage[],
    resumed: ChatMessage | null,
    abortSignal: AbortSignal,
  ): Promise<ReadableStream<InferUIMessageChunk<ChatMessage>>> {
    const now = this.#clock.now();
    const conversation =
      'id' in existing ? existing : await this.#conversations.create({ id, userId: user.id, ...existing, now });
    const { ephemeral } = conversation;
    const outside = isOutsideHistory(conversation);
    const shared = people.length > 1;
    // Saved at once: a page opened or reloaded meanwhile shows the message, then follows its answer. The others in a
    // shared conversation see that the assistant is answering it.
    await this.#conversations.replaceMessages(conversation.id, messages, now);
    await this.#participants.publish(conversation, { type: 'conversation', id: conversation.id });
    await this.#participants.publish(conversation, { type: 'conversations' });
    // Conversations from before icons get theirs at their next message; a title, maybe renamed by the user, stays.
    // Each command gets its prompt before the user's words: for the pre-analysis, the title and the model, never in
    // the saved conversation, which keeps the badge.
    const expanded = await this.#commands.expand(messages, conversation.userId);
    // A comparison's message is sent to both threads: the left one counts it.
    if (!resumed && !conversation.comparedWith) void this.#commands.recordUse(user, messages.at(-1)!);
    // Listed nowhere, an ephemeral conversation or a comparison's right thread needs no name.
    if (!outside && (!conversation.title || !conversation.icon)) {
      void this.#naming.name(user, conversation, expanded[0]!);
    }
    const names = new Map(people.map((person) => [person.id, nameOf(person)]));
    const named = (history: ChatMessage[]) => (shared ? withAuthorNames(history, conversation.userId, names) : history);

    const stream = createUIMessageStream<ChatMessage>({
      originalMessages: messages,
      onEnd: async ({ messages: history }) => {
        try {
          // An ephemeral conversation may be deleted already: its page was left while the answer was stopping.
          const deleted = ephemeral && !(await this.#conversations.find(conversation.id));
          // Stopped after 10 minutes, its run ended already: a newer answer may have begun there since.
          if (!deleted && !this.#runs.replaced(conversation.id, abortSignal)) {
            await this.#conversations.replaceMessages(conversation.id, history, this.#clock.now());
          }
        } finally {
          this.#runs.end(conversation.id, abortSignal);
        }
        await this.#participants.publish(conversation, { type: 'conversation', id: conversation.id });
      },
      onError: (error) => this.#failure(user, error),
      execute: async ({ writer }) => {
        const rules = await this.#memory.rules(user);
        const analysis = await this.#analysis(user, conversation.id, expanded, resumed, rules, abortSignal);
        const messageId = resumed?.id ?? crypto.randomUUID();
        // An answer to a question is a choice, not a remark about how the assistant works. An ephemeral conversation
        // follows the memory, and teaches it nothing; so does a comparison's right thread, its left one learns.
        const remembering =
          analysis.feedback && !resumed && !outside
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

          // The right thread of a comparison answers with the model the admin picked; everything else is the settings'.
          const choice = conversation.modelId
            ? await this.#models.choosePicked(analysis.route, conversation.modelId, user)
            : this.#models.choose(analysis.route, user);
          const documents = await this.#artifacts.latestOf(conversation.id);
          // Expanded after the rewrite: the clearer request replaces only the user's words, never a command's prompt.
          const requested = analysis.rewrittenRequest
            ? await this.#commands.expand(withLatestRequest(messages, analysis.rewrittenRequest), conversation.userId)
            : expanded;
          // Searches spent this turn, counted here because one step may ask for several at once.
          const searches = { count: 0 };
          const tools = {
            ...documentTools(this.#artifacts, user, conversation.id),
            ...(this.#webSearch
              ? { web_search: searchTool(this.#usage, user, conversation.id, this.#webSearch, abortSignal, searches) }
              : {}),
            ...this.#contextTools.for(user, conversation.id, abortSignal, shared),
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
                  withNotes(named(withAnsweredQuestions(requested)), [
                    timeNote(this.#clock.now()),
                    THOUGHTS_NOTE,
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
    return stream;
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
