import type { ConversationRepository } from '../domain/conversation-repository.ts';
import type { Conversation } from '../domain/conversation.ts';
import type { ConversationAccess } from '../domain/sharing.ts';
import type { UserRepository } from '../domain/user-repository.ts';
import type { User } from '../domain/user.ts';
import type { ChangeEvent, ChangeFeed } from './ports/change-feed.ts';

/** Who takes part in a conversation: its owner and those who joined it. They all read it, write in it, hear of it. */
export class Participants {
  readonly #conversations: ConversationRepository;
  readonly #users: UserRepository;
  readonly #changes: ChangeFeed;

  constructor(conversations: ConversationRepository, users: UserRepository, changes: ChangeFeed) {
    this.#conversations = conversations;
    this.#users = users;
    this.#changes = changes;
  }

  /** `null`, as if it did not exist, for anyone else, invited people included. */
  async access(user: User, id: string): Promise<ConversationAccess | null> {
    const conversation = await this.#conversations.find(id);
    if (!conversation) return null;
    if (conversation.userId === user.id) return { conversation, role: 'owner' };
    const members = await this.#conversations.members(id);
    return members.some((member) => member.userId === user.id && member.status === 'member')
      ? { conversation, role: 'member' }
      : null;
  }

  /** The owner first. */
  async of(conversation: Conversation): Promise<number[]> {
    const members = await this.#conversations.members(conversation.id);
    return [
      conversation.userId,
      ...members.filter((member) => member.status === 'member').map((member) => member.userId),
    ];
  }

  /** The owner first. */
  async people(conversation: Conversation): Promise<User[]> {
    const people = await Promise.all((await this.of(conversation)).map((id) => this.#users.findById(id)));
    return people.filter((person) => person !== null);
  }

  /** Every participant's open devices hear of it. */
  async publish(conversation: Conversation | string, change: ChangeEvent): Promise<void> {
    const found = typeof conversation === 'string' ? await this.#conversations.find(conversation) : conversation;
    if (found) this.tell(await this.of(found), change);
  }

  /** For those who are no longer participants, or not yet: a removed member, an invited person. */
  tell(userIds: readonly number[], change: ChangeEvent): void {
    for (const userId of userIds) this.#changes.publish(userId, change);
  }
}
