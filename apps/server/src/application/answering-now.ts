import type { PersonDto } from '@open-agent/shared';

/** A turn whose end was never heard of (a crash in the stream) frees its conversation after this. */
const LONGEST_TURN_MS = 10 * 60 * 1000;

/**
 * In a shared conversation, one answer at a time: two members writing together would each get an answer to a history
 * without the other's message, and the last saved would erase the other. In memory: a restart ends every turn anyway.
 */
export class AnsweringNow {
  readonly #turns = new Map<string, { person: PersonDto; timer: ReturnType<typeof setTimeout> }>();

  /** `false` when an answer is already being written there. */
  take(conversationId: string, person: PersonDto): boolean {
    if (this.#turns.has(conversationId)) return false;
    const timer = setTimeout(() => this.#turns.delete(conversationId), LONGEST_TURN_MS);
    timer.unref();
    this.#turns.set(conversationId, { person, timer });
    return true;
  }

  release(conversationId: string): void {
    clearTimeout(this.#turns.get(conversationId)?.timer);
    this.#turns.delete(conversationId);
  }

  /** Whose message is being answered there; `null` when none is. */
  who(conversationId: string): PersonDto | null {
    return this.#turns.get(conversationId)?.person ?? null;
  }
}
