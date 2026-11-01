import type { Knex } from 'knex';

import type { ConversationRepository } from '../../domain/conversation-repository.ts';
import type { ChatMessage, Conversation } from '../../domain/conversation.ts';

type ConversationRow = {
  id: string;
  user_id: number;
  title: string | null;
  icon: string | null;
  pinned: 0 | 1;
  created_at: string;
  updated_at: string;
};

const COLUMNS = ['id', 'user_id', 'title', 'icon', 'pinned', 'created_at', 'updated_at'] as const;

export class SqliteConversationRepository implements ConversationRepository {
  readonly #database: Knex;

  constructor(database: Knex) {
    this.#database = database;
  }

  async listOf(userId: number): Promise<Conversation[]> {
    const rows: ConversationRow[] = await this.#database('conversations')
      .where({ user_id: userId })
      .select(COLUMNS)
      .orderBy('updated_at', 'desc');
    return rows.map(toConversation);
  }

  async find(id: string): Promise<Conversation | null> {
    const row: ConversationRow | undefined = await this.#database('conversations').where({ id }).first(COLUMNS);
    return row ? toConversation(row) : null;
  }

  async messages(id: string): Promise<ChatMessage[]> {
    const rows: { content: string }[] = await this.#database('messages')
      .where({ conversation_id: id })
      .select('content')
      .orderBy('position');
    return rows.map((row) => JSON.parse(row.content) as ChatMessage);
  }

  async findMessage(conversationId: string, messageId: string): Promise<ChatMessage | null> {
    const row: { content: string } | undefined = await this.#database('messages')
      .where({ conversation_id: conversationId, id: messageId })
      .first('content');
    return row ? (JSON.parse(row.content) as ChatMessage) : null;
  }

  async updateMessage(conversationId: string, message: ChatMessage): Promise<void> {
    await this.#database('messages')
      .where({ conversation_id: conversationId, id: message.id })
      .update({ content: JSON.stringify(message) });
  }

  async create({ id, userId, now }: { id: string; userId: number; now: Date }): Promise<Conversation> {
    const at = now.toISOString();
    await this.#database('conversations').insert({ id, user_id: userId, created_at: at, updated_at: at });
    return { id, userId, title: null, icon: null, pinned: false, createdAt: now, updatedAt: now };
  }

  async replaceMessages(id: string, messages: readonly ChatMessage[], now: Date): Promise<void> {
    await this.#database.transaction(async (transaction) => {
      await transaction('messages').where({ conversation_id: id }).delete();
      if (messages.length > 0) {
        await transaction('messages').insert(
          messages.map((message, position) => ({
            id: message.id,
            conversation_id: id,
            position,
            role: message.role,
            content: JSON.stringify(message),
          })),
        );
      }
      await transaction('conversations').where({ id }).update({ updated_at: now.toISOString() });
    });
  }

  async rename(id: string, title: string): Promise<void> {
    await this.#database('conversations').where({ id }).update({ title });
  }

  async setIcon(id: string, icon: string): Promise<void> {
    await this.#database('conversations').where({ id }).update({ icon });
  }

  async setPinned(id: string, pinned: boolean): Promise<void> {
    await this.#database('conversations').where({ id }).update({ pinned });
  }

  async delete(id: string): Promise<void> {
    await this.#database('conversations').where({ id }).delete();
  }
}

function toConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    icon: row.icon,
    pinned: row.pinned === 1,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}
