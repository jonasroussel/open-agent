import type { MemoryNotice } from '@open-agent/shared';

import type { ConversationRepository } from '../domain/conversation-repository.ts';
import { isExhausted } from '../domain/quota.ts';
import { authorIdOf } from '../domain/sharing.ts';
import type { User } from '../domain/user.ts';
import type { MemoryReconciler } from './memory-reconciler.ts';
import type { Memory } from './memory.ts';
import type { Participants } from './participants.ts';
import { ModelUnavailableError } from './ports/model-catalog.ts';
import { textOf } from './pre-analysis.ts';
import type { Quotas } from './quotas.ts';

/** A message is a remark, not a document: its beginning says what to keep. */
const MAX_REMARK_CHARACTERS = 2000;

export type RememberResult =
  | { ok: true; notice: MemoryNotice | null }
  | { ok: false; reason: 'not_found' | 'invalid_request' | 'quota_exceeded' | 'model_unavailable' };

/**
 * "Remember" on one of the user's own messages: what lasts in it becomes a rule, even when the analysis of that
 * message kept nothing. `notice: null` when the memory already holds it.
 */
export class MessageMemory {
  readonly #conversations: ConversationRepository;
  readonly #participants: Participants;
  readonly #memory: Memory;
  readonly #reconciler: MemoryReconciler;
  readonly #quotas: Quotas;

  constructor(
    conversations: ConversationRepository,
    participants: Participants,
    memory: Memory,
    reconciler: MemoryReconciler,
    quotas: Quotas,
  ) {
    this.#conversations = conversations;
    this.#participants = participants;
    this.#memory = memory;
    this.#reconciler = reconciler;
    this.#quotas = quotas;
  }

  async remember(
    user: User,
    conversationId: unknown,
    messageId: unknown,
    abortSignal: AbortSignal,
  ): Promise<RememberResult> {
    if (typeof conversationId !== 'string' || typeof messageId !== 'string') {
      return { ok: false, reason: 'invalid_request' };
    }
    const access = await this.#participants.access(user, conversationId);
    // Nothing said in an ephemeral conversation is learned.
    const message =
      access && !access.conversation.ephemeral
        ? await this.#conversations.findMessage(conversationId, messageId)
        : null;
    if (message?.role !== 'user' || authorIdOf(message, access!.conversation.userId) !== user.id) {
      return { ok: false, reason: 'not_found' };
    }
    const text = textOf(message);
    if (!text) return { ok: false, reason: 'invalid_request' };
    if (isExhausted(await this.#quotas.of(user))) return { ok: false, reason: 'quota_exceeded' };

    const rules = await this.#memory.rules(user);
    try {
      const edit = await this.#reconciler.reconcile(
        user,
        conversationId,
        text.slice(0, MAX_REMARK_CHARACTERS),
        rules,
        abortSignal,
        true,
      );
      return { ok: true, notice: edit ? await this.#memory.applyRemark(user, edit, null) : null };
    } catch (error) {
      if (abortSignal.aborted) throw error;
      if (!(error instanceof ModelUnavailableError)) console.error('Remembering a message failed:', error);
      return { ok: false, reason: 'model_unavailable' };
    }
  }
}
