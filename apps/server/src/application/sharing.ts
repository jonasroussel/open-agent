import { personNameOf } from '@open-agent/shared';

import type { ConversationRepository } from '../domain/conversation-repository.ts';
import type { UserRepository } from '../domain/user-repository.ts';
import type { User } from '../domain/user.ts';
import type { Participants } from './participants.ts';
import type { Clock } from './ports/clock.ts';
import type { Mailer } from './ports/mailer.ts';

/** More would be a group chat, not a family conversation; it also bounds the emails one click sends. */
const MAX_MEMBERS = 10;

export type SharingResult = { ok: true } | { ok: false; reason: 'not_found' | 'invalid_request' };

/**
 * The owner of a conversation invites people of the app to it; each joins or declines. Joining shows them the whole
 * history. The owner removes anyone; a member leaves when they want.
 */
export class Sharing {
  readonly #conversations: ConversationRepository;
  readonly #participants: Participants;
  readonly #users: UserRepository;
  readonly #mailer: Mailer;
  readonly #clock: Clock;
  readonly #publicUrl: string;

  constructor(
    conversations: ConversationRepository,
    participants: Participants,
    users: UserRepository,
    mailer: Mailer,
    clock: Clock,
    publicUrl: string,
  ) {
    this.#conversations = conversations;
    this.#participants = participants;
    this.#users = users;
    this.#mailer = mailer;
    this.#clock = clock;
    this.#publicUrl = publicUrl;
  }

  /** Who the user may share with: everyone of the app whose access was not revoked. */
  async people(user: User): Promise<User[]> {
    return (await this.#users.list()).filter((person) => person.id !== user.id && !person.revokedAt);
  }

  /** Each newly invited person gets an email; those already invited or in it are left as they are. */
  async invite(user: User, id: string, userIds: unknown): Promise<SharingResult> {
    const access = await this.#participants.access(user, id);
    if (access?.role !== 'owner') return { ok: false, reason: 'not_found' };
    if (!Array.isArray(userIds) || userIds.length === 0 || !userIds.every(Number.isInteger)) {
      return { ok: false, reason: 'invalid_request' };
    }
    const people = new Map((await this.people(user)).map((person) => [person.id, person]));
    const members = await this.#conversations.members(id);
    const already = new Set(members.map((member) => member.userId));
    const invited = [...new Set(userIds as number[])].filter((userId) => !already.has(userId));
    if (invited.some((userId) => !people.has(userId)) || members.length + invited.length > MAX_MEMBERS) {
      return { ok: false, reason: 'invalid_request' };
    }

    await this.#conversations.invite(id, invited, this.#clock.now());
    this.#participants.tell(invited, { type: 'conversations' });
    await this.#participants.publish(access.conversation, { type: 'conversations' });
    // The invitation shows in the app at once; an email that could not leave does not undo it.
    for (const userId of invited) {
      const person = people.get(userId)!;
      this.#mailer
        .sendShare({
          to: person.email,
          locale: person.locale,
          from: personNameOf(user.email),
          title: access.conversation.title,
          link: `${this.#publicUrl}/c/${id}`,
        })
        .catch((error: unknown) => console.error('Sending a share invitation failed:', error));
    }
    return { ok: true };
  }

  async join(user: User, id: string): Promise<SharingResult> {
    const invitation = (await this.#conversations.members(id)).find((member) => member.userId === user.id);
    if (invitation?.status !== 'invited') return { ok: false, reason: 'not_found' };
    await this.#conversations.join(id, user.id, this.#clock.now());
    await this.#participants.publish(id, { type: 'conversations' });
    return { ok: true };
  }

  /** The owner removes anyone; anyone else only themselves: a member leaves, an invited person declines. */
  async remove(user: User, id: string, userId: number): Promise<SharingResult> {
    const conversation = await this.#conversations.find(id);
    const member = (await this.#conversations.members(id)).find((found) => found.userId === userId);
    if (!conversation || !member || (conversation.userId !== user.id && userId !== user.id)) {
      return { ok: false, reason: 'not_found' };
    }
    await this.#conversations.removeMember(id, userId);
    // Their open page leaves the conversation, which now answers "not found".
    this.#participants.tell([userId], { type: 'conversation', id });
    this.#participants.tell([userId], { type: 'conversations' });
    await this.#participants.publish(conversation, { type: 'conversations' });
    return { ok: true };
  }
}
