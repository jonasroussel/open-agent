import type { ChatMessage, Conversation } from './conversation.ts';

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
}
