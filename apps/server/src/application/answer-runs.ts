import type { ChatMessage, PersonDto } from '@open-agent/shared';
import type { InferUIMessageChunk } from 'ai';

export type AnswerChunk = InferUIMessageChunk<ChatMessage>;

/** A turn whose end was never heard of (a crash in the stream) is stopped and forgotten after this. */
const LONGEST_TURN_MS = 10 * 60 * 1000;

type Run = {
  person: PersonDto;
  controller: AbortController;
  /** Every chunk so far: a browser that comes back gets the answer from its start. */
  chunks: AnswerChunk[];
  followers: Set<ReadableStreamDefaultController<AnswerChunk>>;
  done: boolean;
  timer: ReturnType<typeof setTimeout>;
};

/**
 * The answers being written, one per conversation. The server owns them: a browser that leaves (a reload, a phone put
 * away, another page) stops nothing; it follows the answer again when it comes back. Only `stop` ends one early. In
 * memory: a restart ends every answer anyway.
 */
export class AnswerRuns {
  readonly #runs = new Map<string, Run>();

  /** `null` when an answer is already being written there. */
  begin(conversationId: string, person: PersonDto): AbortSignal | null {
    if (this.#runs.has(conversationId)) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort(new Error('The answer took too long.'));
      this.end(conversationId);
    }, LONGEST_TURN_MS);
    timer.unref();
    this.#runs.set(conversationId, { person, controller, chunks: [], followers: new Set(), done: false, timer });
    return controller.signal;
  }

  /** Reads the turn's stream to its end, whoever follows it, and passes each chunk to its followers. */
  feed(conversationId: string, stream: ReadableStream<AnswerChunk>): void {
    const run = this.#runs.get(conversationId);
    if (!run) return;
    void (async () => {
      try {
        for await (const chunk of stream) {
          run.chunks.push(chunk);
          for (const follower of run.followers) follower.enqueue(chunk);
        }
      } catch (error) {
        console.error('An answer stream failed:', error);
      } finally {
        run.done = true;
        for (const follower of run.followers) follower.close();
        run.followers.clear();
      }
    })();
  }

  /** The answer from its start, then live, until it ends; `null` when none is being written there. */
  follow(conversationId: string): ReadableStream<AnswerChunk> | null {
    const run = this.#runs.get(conversationId);
    if (!run) return null;
    let self: ReadableStreamDefaultController<AnswerChunk> | null = null;
    return new ReadableStream<AnswerChunk>({
      start(controller) {
        for (const chunk of run.chunks) controller.enqueue(chunk);
        if (run.done) {
          controller.close();
          return;
        }
        self = controller;
        run.followers.add(controller);
      },
      // The browser left: the answer goes on without it.
      cancel() {
        if (self) run.followers.delete(self);
      },
    });
  }

  /** Whose message is being answered there; `null` when none is. */
  who(conversationId: string): PersonDto | null {
    return this.#runs.get(conversationId)?.person ?? null;
  }

  /** The user's Stop, or the conversation deleted: the answer ends as it is, and is saved so. */
  stop(conversationId: string): void {
    this.#runs.get(conversationId)?.controller.abort();
  }

  /** Once the answer is saved: the conversation takes a new message. */
  end(conversationId: string): void {
    clearTimeout(this.#runs.get(conversationId)?.timer);
    this.#runs.delete(conversationId);
  }
}
