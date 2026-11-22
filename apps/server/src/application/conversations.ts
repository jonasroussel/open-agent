import { MAX_CONVERSATION_TITLE_LENGTH, dataModelIsValid } from '@open-agent/shared';

import type { ConversationRepository } from '../domain/conversation-repository.ts';
import {
  cleanSnippet,
  searchTerms,
  type ChatMessage,
  type Conversation,
  type SnippetPart,
} from '../domain/conversation.ts';
import { visibleTo, type ConversationAccess, type ConversationMember, type MemberStatus } from '../domain/sharing.ts';
import { withSurfaceState } from '../domain/surfaces.ts';
import type { UserRepository } from '../domain/user-repository.ts';
import type { User } from '../domain/user.ts';
import type { AnswerRuns } from './answer-runs.ts';
import type { Participants } from './participants.ts';
import type { Clock } from './ports/clock.ts';

const SEARCH_RESULTS = 20;
/** An ephemeral conversation whose page was closed without a word (a crash, a dead phone) goes after a day. */
const EPHEMERAL_MS = 24 * 60 * 60 * 1000;

export type ConversationUpdate = { title?: unknown; pinned?: unknown };

/** Who a shared conversation is shared with, as one of its participants sees it. */
export type SharingView = {
  role: 'owner' | 'member';
  owner: User;
  members: { user: User; status: MemberStatus }[];
};

/** The right thread of a comparison, shown with its left conversation. */
export type ComparisonView = { conversationId: string; modelId: string };

/**
 * A conversation as the user sees it: their own pin, with whom it is shared (`null`: nobody), and its right thread when
 * it is the left conversation of a comparison.
 */
export type ConversationView = {
  conversation: Conversation;
  pinned: boolean;
  sharing: SharingView | null;
  comparison: ComparisonView | null;
};

export type Invitation = { conversation: Conversation; from: User; invitedAt: Date };

export type SearchView = { view: ConversationView; snippet: SnippetPart[] };

/**
 * The conversations a user owns or joined: anyone else's answer `null`, as if they did not exist. In a shared one,
 * everyone renames it, each pins it for themselves, and only its owner deletes it.
 */
export class Conversations {
  readonly #conversations: ConversationRepository;
  readonly #participants: Participants;
  readonly #users: UserRepository;
  readonly #runs: AnswerRuns;
  readonly #clock: Clock;

  constructor(
    conversations: ConversationRepository,
    participants: Participants,
    users: UserRepository,
    runs: AnswerRuns,
    clock: Clock,
  ) {
    this.#conversations = conversations;
    this.#participants = participants;
    this.#users = users;
    this.#runs = runs;
    this.#clock = clock;
  }

  /**
   * Last updated first, with the invitations they have not answered. Ephemeral conversations are never listed; those
   * left behind are deleted here, everyone's: the list loads each time someone opens the app.
   */
  async list(user: User): Promise<{ conversations: ConversationView[]; invitations: Invitation[] }> {
    await this.#conversations.deleteEphemeralBefore(new Date(this.#clock.now().getTime() - EPHEMERAL_MS));

    const [owned, ownedMembers, memberships, people, rightThreads] = await Promise.all([
      this.#conversations.listOf(user.id),
      this.#conversations.membersOfOwned(user.id),
      this.#conversations.memberships(user.id),
      this.#people(),
      this.#conversations.rightThreadsOf(user.id),
    ]);
    const comparisons = new Map(rightThreads.map((right) => [right.comparedWith, comparisonOf(right)]));
    const joined = memberships.filter(({ member }) => member.status === 'member');
    const joinedMembers = await Promise.all(
      joined.map(({ conversation }) => this.#conversations.members(conversation.id)),
    );

    const views = [
      ...owned.map((conversation) => ({
        conversation,
        pinned: conversation.pinned,
        sharing: sharingOf(
          'owner',
          conversation,
          ownedMembers.filter((member) => member.conversationId === conversation.id),
          people,
        ),
        comparison: comparisons.get(conversation.id) ?? null,
      })),
      ...joined.map(({ conversation, member }, index) => ({
        conversation,
        pinned: member.pinned,
        sharing: sharingOf('member', conversation, joinedMembers[index]!, people),
        comparison: null,
      })),
    ].toSorted((a, b) => b.conversation.updatedAt.getTime() - a.conversation.updatedAt.getTime());

    const invitations = memberships.flatMap(({ conversation, member }) => {
      const from = people.get(conversation.userId);
      return member.status === 'invited' && from ? [{ conversation, from, invitedAt: member.invitedAt }] : [];
    });
    return { conversations: views, invitations };
  }

  /**
   * With whose message is being answered, in a shared conversation. A memory notice shows only to the person whose
   * memory changed.
   */
  async open(
    user: User,
    id: string,
  ): Promise<{ view: ConversationView; messages: ChatMessage[]; answering: User | null } | null> {
    const access = await this.#participants.access(user, id);
    if (!access) return null;
    const messages = await this.#conversations.messages(id);
    const answering = this.#runs.who(id);
    return {
      view: await this.#view(user, access),
      messages: visibleTo(messages, user.id, access.conversation.userId),
      answering: answering ? await this.#users.findById(answering.id) : null,
    };
  }

  /** Full-text search in the conversations the user owns or joined; an empty search finds nothing. */
  async search(user: User, text: string): Promise<SearchView[]> {
    const hits = await this.#conversations.search(user.id, searchTerms(text), SEARCH_RESULTS);
    if (hits.length === 0) return [];
    const views = new Map((await this.list(user)).conversations.map((view) => [view.conversation.id, view]));
    return hits.flatMap((hit) => {
      const view = views.get(hit.conversation.id);
      return view ? [{ view, snippet: cleanSnippet(hit.snippet) }] : [];
    });
  }

  async update(
    user: User,
    id: string,
    update: ConversationUpdate,
  ): Promise<{ ok: true; view: ConversationView } | { ok: false; reason: 'not_found' | 'invalid_request' }> {
    const title = typeof update.title === 'string' ? update.title.trim() : undefined;
    if (update.title !== undefined && (!title || title.length > MAX_CONVERSATION_TITLE_LENGTH)) {
      return { ok: false, reason: 'invalid_request' };
    }
    if (update.pinned !== undefined && typeof update.pinned !== 'boolean') {
      return { ok: false, reason: 'invalid_request' };
    }

    const access = await this.#participants.access(user, id);
    if (!access) return { ok: false, reason: 'not_found' };
    if (title) {
      await this.#conversations.rename(id, title);
      await this.#participants.publish(access.conversation, { type: 'conversations' });
    }
    if (typeof update.pinned === 'boolean') {
      if (access.role === 'owner') {
        await this.#conversations.setPinned(id, update.pinned);
      } else {
        await this.#conversations.setMemberPinned(id, user.id, update.pinned);
      }
      this.#participants.tell([user.id], { type: 'conversations' });
    }
    const updated = await this.#participants.access(user, id);
    return { ok: true, view: await this.#view(user, updated ?? access) };
  }

  /**
   * A participant ticked or chose something in a `show_ui` surface: its whole new state, which every participant's
   * devices then load, and the model reads at the next answer.
   */
  async saveSurfaceState(
    user: User,
    id: string,
    messageId: string,
    toolCallId: string,
    dataModel: unknown,
  ): Promise<{ ok: true } | { ok: false; reason: 'not_found' | 'invalid_request' }> {
    if (!dataModelIsValid(dataModel)) return { ok: false, reason: 'invalid_request' };
    const access = await this.#participants.access(user, id);
    if (!access) return { ok: false, reason: 'not_found' };
    const message = await this.#conversations.findMessage(id, messageId);
    if (!message) return { ok: false, reason: 'not_found' };
    const changed = withSurfaceState(message, toolCallId, dataModel);
    if (!changed.ok) return changed;
    await this.#conversations.updateMessage(id, changed.message);
    await this.#participants.publish(access.conversation, { type: 'conversation', id });
    return { ok: true };
  }

  /**
   * Its owner only, for everyone in it; a member leaves it instead. The left conversation of a comparison takes its
   * right thread along.
   */
  async delete(user: User, id: string): Promise<boolean> {
    const access = await this.#participants.access(user, id);
    if (access?.role !== 'owner') return false;
    // Read before: the members go with the conversation. Invited people lose their invitation.
    const everyone = [user.id, ...(await this.#conversations.members(id)).map((member) => member.userId)];
    const right = await this.#conversations.rightThreadOf(user.id, id);
    // An answer being written stops: it would be saved into a conversation that no longer exists.
    this.#runs.stop(id);
    await this.#conversations.delete(id);
    if (right) {
      this.#runs.stop(right.id);
      await this.#conversations.delete(right.id);
      this.#participants.tell([user.id], { type: 'conversation', id: right.id });
    }
    this.#participants.tell(everyone, { type: 'conversation', id });
    this.#participants.tell(everyone, { type: 'conversations' });
    return true;
  }

  async #view(user: User, access: ConversationAccess): Promise<ConversationView> {
    const [members, people, right] = await Promise.all([
      this.#conversations.members(access.conversation.id),
      this.#people(),
      this.#conversations.rightThreadOf(access.conversation.userId, access.conversation.id),
    ]);
    const own = members.find((member) => member.userId === user.id);
    return {
      conversation: access.conversation,
      pinned: access.role === 'owner' ? access.conversation.pinned : (own?.pinned ?? false),
      sharing: sharingOf(access.role, access.conversation, members, people),
      comparison: right && comparisonOf(right),
    };
  }

  async #people(): Promise<Map<number, User>> {
    return new Map((await this.#users.list()).map((person) => [person.id, person]));
  }
}

function comparisonOf(right: Conversation): ComparisonView {
  return { conversationId: right.id, modelId: right.modelId! };
}

/** `null` once nobody is invited nor in it any more. */
function sharingOf(
  role: 'owner' | 'member',
  conversation: Conversation,
  members: readonly ConversationMember[],
  people: ReadonlyMap<number, User>,
): SharingView | null {
  const owner = people.get(conversation.userId);
  const known = members.flatMap((member) => {
    const person = people.get(member.userId);
    return person ? [{ user: person, status: member.status }] : [];
  });
  return owner && known.length > 0 ? { role, owner, members: known } : null;
}
