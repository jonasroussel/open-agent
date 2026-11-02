import type { ConversationRepository } from '../domain/conversation-repository.ts';
import {
  cleanSnippet,
  searchTerms,
  type ChatMessage,
  type Conversation,
  type SearchHit,
} from '../domain/conversation.ts';
import type { User } from '../domain/user.ts';
import type { ChangeFeed } from './ports/change-feed.ts';

const MAX_TITLE_LENGTH = 80;
const SEARCH_RESULTS = 20;

export type ConversationUpdate = { title?: unknown; pinned?: unknown };

/** A user's own conversations: anyone else's answer `null`, as if they did not exist. */
export class Conversations {
  readonly #conversations: ConversationRepository;
  readonly #changes: ChangeFeed;

  constructor(conversations: ConversationRepository, changes: ChangeFeed) {
    this.#conversations = conversations;
    this.#changes = changes;
  }

  list(user: User): Promise<Conversation[]> {
    return this.#conversations.listOf(user.id);
  }

  async open(user: User, id: string): Promise<{ conversation: Conversation; messages: ChatMessage[] } | null> {
    const conversation = await this.#owned(user, id);
    return conversation ? { conversation, messages: await this.#conversations.messages(id) } : null;
  }

  /** Full-text search in the user's own history; an empty search finds nothing. */
  async search(user: User, text: string): Promise<SearchHit[]> {
    const hits = await this.#conversations.search(user.id, searchTerms(text), SEARCH_RESULTS);
    return hits.map((hit) => ({ ...hit, snippet: cleanSnippet(hit.snippet) }));
  }

  async update(
    user: User,
    id: string,
    update: ConversationUpdate,
  ): Promise<{ ok: true; conversation: Conversation } | { ok: false; reason: 'not_found' | 'invalid_request' }> {
    const title = typeof update.title === 'string' ? update.title.trim() : undefined;
    if (update.title !== undefined && (!title || title.length > MAX_TITLE_LENGTH)) {
      return { ok: false, reason: 'invalid_request' };
    }
    if (update.pinned !== undefined && typeof update.pinned !== 'boolean')
      return { ok: false, reason: 'invalid_request' };

    const conversation = await this.#owned(user, id);
    if (!conversation) return { ok: false, reason: 'not_found' };
    if (title) await this.#conversations.rename(id, title);
    if (typeof update.pinned === 'boolean') await this.#conversations.setPinned(id, update.pinned);
    this.#changes.publish(user.id, { type: 'conversations' });
    return {
      ok: true,
      conversation: {
        ...conversation,
        title: title ?? conversation.title,
        pinned: update.pinned ?? conversation.pinned,
      },
    };
  }

  async delete(user: User, id: string): Promise<boolean> {
    if (!(await this.#owned(user, id))) return false;
    await this.#conversations.delete(id);
    this.#changes.publish(user.id, { type: 'conversation', id });
    return true;
  }

  async #owned(user: User, id: string): Promise<Conversation | null> {
    const conversation = await this.#conversations.find(id);
    return conversation?.userId === user.id ? conversation : null;
  }
}
