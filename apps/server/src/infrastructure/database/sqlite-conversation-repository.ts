import type { Knex } from 'knex';

import type { ConversationRepository } from '../../domain/conversation-repository.ts';
import type { ChatMessage, Conversation, SearchHit, SnippetPart } from '../../domain/conversation.ts';
import type { ConversationMember, MemberStatus } from '../../domain/sharing.ts';

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

type MemberRow = {
  conversation_id: string;
  user_id: number;
  status: MemberStatus;
  pinned: 0 | 1;
  invited_at: string;
  joined_at: string | null;
};

/** `c` is a conversation `?` owns or joined. */
const TAKES_PART = `(c.user_id = ? OR EXISTS (SELECT 1 FROM conversation_members cm
  WHERE cm.conversation_id = c.id AND cm.user_id = ? AND cm.status = 'member'))`;

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

  async search(userId: number, terms: readonly string[], limit: number): Promise<SearchHit[]> {
    if (terms.length === 0) return [];
    // Each term quoted (FTS5 syntax stays literal) and open-ended: « resil » finds « résiliation ».
    const match = terms.map((term) => `"${term.replaceAll('"', '""')}"*`).join(' ');
    // Best messages first; FTS5 refuses `snippet` beside a window function, so the best one per conversation is kept
    // here rather than in SQL.
    const rows: (ConversationRow & { snippet: string })[] = await this.#database.raw(
      `SELECT ${COLUMNS.map((column) => `c.${column}`).join(', ')},
          snippet(message_search, 0, char(2), char(3), '…', 16) AS snippet
        FROM message_search
        JOIN messages m ON m.rowid = message_search.rowid
        JOIN conversations c ON c.id = m.conversation_id
        WHERE message_search MATCH ? AND ${TAKES_PART}
        ORDER BY bm25(message_search)
        LIMIT 500`,
      [match, userId, userId],
    );
    const best: Record<string, SearchHit> = {};
    for (const row of rows) best[row.id] ??= { conversation: toConversation(row), snippet: snippetParts(row.snippet) };
    return Object.values(best)
      .toSorted((a, b) => b.conversation.updatedAt.getTime() - a.conversation.updatedAt.getTime())
      .slice(0, limit);
  }

  async members(conversationId: string): Promise<ConversationMember[]> {
    const rows: MemberRow[] = await this.#database('conversation_members')
      .where({ conversation_id: conversationId })
      .orderBy('invited_at');
    return rows.map(toMember);
  }

  async membersOfOwned(userId: number): Promise<ConversationMember[]> {
    const rows: MemberRow[] = await this.#database('conversation_members as cm')
      .join('conversations as c', 'c.id', 'cm.conversation_id')
      .where('c.user_id', userId)
      .select('cm.*')
      .orderBy('cm.invited_at');
    return rows.map(toMember);
  }

  async memberships(userId: number): Promise<{ conversation: Conversation; member: ConversationMember }[]> {
    const rows: (ConversationRow & {
      member_status: MemberStatus;
      member_pinned: 0 | 1;
      invited_at: string;
      joined_at: string | null;
    })[] = await this.#database('conversation_members as cm')
      .join('conversations as c', 'c.id', 'cm.conversation_id')
      .where('cm.user_id', userId)
      .select(
        ...COLUMNS.map((column) => `c.${column}`),
        'cm.status as member_status',
        'cm.pinned as member_pinned',
        'cm.invited_at',
        'cm.joined_at',
      )
      .orderBy('c.updated_at', 'desc');
    return rows.map((row) => ({
      conversation: toConversation(row),
      member: toMember({
        conversation_id: row.id,
        user_id: userId,
        status: row.member_status,
        pinned: row.member_pinned,
        invited_at: row.invited_at,
        joined_at: row.joined_at,
      }),
    }));
  }

  async invite(conversationId: string, userIds: readonly number[], now: Date): Promise<void> {
    if (userIds.length === 0) return;
    await this.#database('conversation_members')
      .insert(
        userIds.map((userId) => ({
          conversation_id: conversationId,
          user_id: userId,
          status: 'invited',
          invited_at: now.toISOString(),
        })),
      )
      .onConflict(['conversation_id', 'user_id'])
      .ignore();
  }

  async join(conversationId: string, userId: number, now: Date): Promise<void> {
    await this.#database('conversation_members')
      .where({ conversation_id: conversationId, user_id: userId })
      .update({ status: 'member', joined_at: now.toISOString() });
  }

  async removeMember(conversationId: string, userId: number): Promise<void> {
    await this.#database('conversation_members').where({ conversation_id: conversationId, user_id: userId }).delete();
  }

  async setMemberPinned(conversationId: string, userId: number, pinned: boolean): Promise<void> {
    await this.#database('conversation_members')
      .where({ conversation_id: conversationId, user_id: userId })
      .update({ pinned });
  }

  async sharesFile(viewerId: number, fileId: string, fileOwnerId: number): Promise<boolean> {
    const rows: unknown[] = await this.#database.raw(
      `SELECT 1 FROM messages m JOIN conversations c ON c.id = m.conversation_id
        WHERE instr(m.content, ?) > 0 AND ${TAKES_PART} AND ${TAKES_PART}
        LIMIT 1`,
      [fileId, viewerId, viewerId, fileOwnerId, fileOwnerId],
    );
    return rows.length > 0;
  }
}

function toMember(row: MemberRow): ConversationMember {
  return {
    conversationId: row.conversation_id,
    userId: row.user_id,
    status: row.status,
    pinned: row.pinned === 1,
    invitedAt: new Date(row.invited_at),
    joinedAt: row.joined_at ? new Date(row.joined_at) : null,
  };
}

/** `snippet` wraps each found word in \x02 … \x03. */
function snippetParts(snippet: string): SnippetPart[] {
  return snippet.split('\x03').flatMap((piece) => {
    const [before = '', found] = piece.split('\x02');
    return found === undefined
      ? [{ text: before, match: false }]
      : [
          { text: before, match: false },
          { text: found, match: true },
        ];
  });
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
