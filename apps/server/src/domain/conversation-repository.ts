import type { ChatMessage, Conversation, SearchHit } from './conversation.ts';
import type { ConversationMember } from './sharing.ts';

export interface ConversationRepository {
  /** The user's conversations, last updated first. */
  listOf(userId: number): Promise<Conversation[]>;
  find(id: string): Promise<Conversation | null>;
  /** In order, oldest first. */
  messages(id: string): Promise<ChatMessage[]>;
  findMessage(conversationId: string, messageId: string): Promise<ChatMessage | null>;
  /** Rewrites a saved message in place, keeping its position. */
  updateMessage(conversationId: string, message: ChatMessage): Promise<void>;
  create(conversation: { id: string; userId: number; now: Date }): Promise<Conversation>;
  /** The whole history after a turn: an edit or a regeneration drops the messages after it. */
  replaceMessages(id: string, messages: readonly ChatMessage[], now: Date): Promise<void>;
  rename(id: string, title: string): Promise<void>;
  setIcon(id: string, icon: string): Promise<void>;
  setPinned(id: string, pinned: boolean): Promise<void>;
  delete(id: string): Promise<void>;
  /** The conversations the user owns or joined whose messages hold every term (or a word starting with it). */
  search(userId: number, terms: readonly string[], limit: number): Promise<SearchHit[]>;

  /** Everyone invited to or in the conversation, besides its owner, first invited first. */
  members(conversationId: string): Promise<ConversationMember[]>;
  /** The members of every conversation the user owns. */
  membersOfOwned(userId: number): Promise<ConversationMember[]>;
  /** The conversations the user was invited to or joined, with their membership. */
  memberships(userId: number): Promise<{ conversation: Conversation; member: ConversationMember }[]>;
  /** Those already invited or in stay as they are. */
  invite(conversationId: string, userIds: readonly number[], now: Date): Promise<void>;
  join(conversationId: string, userId: number, now: Date): Promise<void>;
  removeMember(conversationId: string, userId: number): Promise<void>;
  setMemberPinned(conversationId: string, userId: number, pinned: boolean): Promise<void>;
  /**
   * Whether a conversation the viewer owns or joined, which the file's owner also owns or joined, mentions the file:
   * a file sent or made in a shared conversation opens for its members, no other file does.
   */
  sharesFile(viewerId: number, fileId: string, fileOwnerId: number): Promise<boolean>;
}
