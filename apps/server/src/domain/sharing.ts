import type { PersonDto } from '@open-agent/shared';

import type { ChatMessage, Conversation } from './conversation.ts';

export type MemberStatus = 'invited' | 'member';

/** Someone a conversation is shared with, besides its owner: invited until they join. */
export type ConversationMember = {
  conversationId: string;
  userId: number;
  status: MemberStatus;
  /** For them only. */
  pinned: boolean;
  invitedAt: Date;
  joinedAt: Date | null;
};

/** How a user may reach a conversation: its owner, or someone who joined it. Invited is not enough. */
export type ConversationAccess = { conversation: Conversation; role: 'owner' | 'member' };

/** Who sent a user message: its author, or the owner for the messages from before the sharing. */
export function authorIdOf(message: ChatMessage, ownerId: number): number {
  return message.metadata?.author?.id ?? ownerId;
}

/** A user message the server received: who sent it is the server's to say, never the client's. */
export function signedBy(message: ChatMessage, sender: PersonDto): ChatMessage {
  return message.role === 'user' ? { ...message, metadata: { ...message.metadata, author: sender } } : message;
}

export type ContinuedHistory =
  | { ok: true; messages: ChatMessage[] }
  /** `conversation_changed`: the sender's copy is behind the saved one. `not_allowed`: someone else's message. */
  | { ok: false; reason: 'conversation_changed' | 'not_allowed' };

const idsOf = (messages: readonly ChatMessage[]) => messages.map((message) => message.id);
const sameIds = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id, index) => id === b[index]);

/**
 * A shared conversation goes on from its saved history, never from the copy a member's browser sends: that copy may
 * miss what the others wrote meanwhile, or hold changes to their messages. Only the sent message is taken, and only:
 * - a new message, when the copy held every saved message;
 * - the sender's last message again (edited, or to answer again), dropping only its answer;
 * - the answers to the questions ending the last answer, asked to the sender.
 */
export function continuedHistory(
  saved: readonly ChatMessage[],
  sent: readonly ChatMessage[],
  sender: PersonDto,
  ownerId: number,
): ContinuedHistory {
  const last = sent.at(-1);
  if (!last) return { ok: false, reason: 'conversation_changed' };
  const before = idsOf(sent.slice(0, -1));

  if (last.role === 'assistant') {
    if (!sameIds(idsOf(sent), idsOf(saved))) return { ok: false, reason: 'conversation_changed' };
    const asked = saved.findLast((message) => message.role === 'user');
    if (asked && authorIdOf(asked, ownerId) !== sender.id) return { ok: false, reason: 'not_allowed' };
    return { ok: true, messages: [...saved.slice(0, -1), last] };
  }

  const index = saved.findIndex((message) => message.id === last.id);
  if (index === -1) {
    if (!sameIds(before, idsOf(saved))) return { ok: false, reason: 'conversation_changed' };
    return { ok: true, messages: [...saved, signedBy(last, sender)] };
  }
  if (!sameIds(before, idsOf(saved.slice(0, index)))) return { ok: false, reason: 'conversation_changed' };
  const lastUser = saved.findLastIndex((message) => message.role === 'user');
  if (index !== lastUser || authorIdOf(saved[index]!, ownerId) !== sender.id) {
    return { ok: false, reason: 'not_allowed' };
  }
  return { ok: true, messages: [...saved.slice(0, index), signedBy(last, sender)] };
}

/**
 * For the model only, in a shared conversation: each user message opens with its writer's current name (`names`, by
 * id), whatever it was when they wrote it. Someone who left keeps the name they had.
 */
export function withAuthorNames(
  messages: readonly ChatMessage[],
  ownerId: number,
  names: ReadonlyMap<number, string>,
): ChatMessage[] {
  return messages.map((message) => {
    if (message.role !== 'user') return message;
    const name = names.get(authorIdOf(message, ownerId)) ?? message.metadata?.author?.name ?? '?';
    return { ...message, parts: [{ type: 'text', text: `[${name}]` }, ...message.parts] };
  });
}

/** A memory notice tells what changed in someone's memory: in a shared conversation, only they see it. */
export function visibleTo(messages: readonly ChatMessage[], viewerId: number, ownerId: number): ChatMessage[] {
  return messages.map((message) => ({
    ...message,
    parts: message.parts.filter((part) => part.type !== 'data-memory' || (part.data.userId ?? ownerId) === viewerId),
  }));
}
