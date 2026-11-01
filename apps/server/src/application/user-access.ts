import { normalizeEmail, type Locale } from '@open-agent/shared';

import type { UserRepository } from '../domain/user-repository.ts';
import type { User } from '../domain/user.ts';
import { signInLink } from './authentication.ts';
import type { Clock } from './ports/clock.ts';
import type { Mailer } from './ports/mailer.ts';
import type { SessionStore } from './ports/session-store.ts';
import type { SignInRequestStore } from './ports/sign-in-request-store.ts';

/** An invitation may wait in an inbox for days. It has no code: the first sign-in happens in the browser anyway. */
const INVITATION_DAYS = 7;

export type InviteResult =
  | { ok: true; user: User }
  | { ok: false; reason: 'invalid_request' }
  /** The access is given; only the email is missing. Inviting again resends it. */
  | { ok: false; reason: 'email_failed'; user: User };

export type RevokeResult = { ok: true } | { ok: false; reason: 'not_found' | 'cannot_revoke_self' };

/** Who may use the app: the admin invites by email and can revoke. */
export class UserAccess {
  readonly #users: UserRepository;
  readonly #sessions: SessionStore;
  readonly #signInRequests: SignInRequestStore;
  readonly #mailer: Mailer;
  readonly #clock: Clock;
  readonly #publicUrl: string;

  constructor(
    users: UserRepository,
    sessions: SessionStore,
    signInRequests: SignInRequestStore,
    mailer: Mailer,
    clock: Clock,
    publicUrl: string,
  ) {
    this.#users = users;
    this.#sessions = sessions;
    this.#signInRequests = signInRequests;
    this.#mailer = mailer;
    this.#clock = clock;
    this.#publicUrl = publicUrl;
  }

  list(): Promise<User[]> {
    return this.#users.list();
  }

  /** New address: creates the user. Revoked: restores the access. Either way, emails an invitation. */
  async invite(admin: User, rawEmail: string, locale: Locale): Promise<InviteResult> {
    const email = normalizeEmail(rawEmail);
    if (!email) return { ok: false, reason: 'invalid_request' };
    const now = this.#clock.now();

    const existing = await this.#users.findByEmail(email);
    if (existing?.revokedAt) await this.#users.restore(existing.id);
    const user = existing
      ? { ...existing, revokedAt: null }
      : await this.#users.create({ email, role: 'user', locale, invitedBy: admin.id, invitedAt: now });

    const { token } = await this.#signInRequests.create({
      userId: user.id,
      expiresAt: new Date(now.getTime() + INVITATION_DAYS * 24 * 60 * 60_000),
      withCode: false,
      now,
    });
    try {
      await this.#mailer.sendSignIn({
        to: user.email,
        locale,
        kind: 'invitation',
        link: signInLink(this.#publicUrl, token),
        code: null,
        validForMinutes: INVITATION_DAYS * 24 * 60,
      });
      return { ok: true, user };
    } catch (error) {
      console.error('Invitation email failed:', error);
      return { ok: false, reason: 'email_failed', user };
    }
  }

  /** Ends every session at once; the conversations stay, in case the access comes back. */
  async revoke(admin: User, userId: number): Promise<RevokeResult> {
    if (userId === admin.id) return { ok: false, reason: 'cannot_revoke_self' };
    const user = await this.#users.findById(userId);
    if (!user) return { ok: false, reason: 'not_found' };
    if (!user.revokedAt) await this.#users.revoke(user.id, this.#clock.now());
    await this.#sessions.deleteAllOf(user.id);
    return { ok: true };
  }

  /** At boot, from `ADMIN_EMAIL`: the first admin exists without anyone inviting them. */
  async ensureAdmin(rawEmail: string): Promise<void> {
    const email = normalizeEmail(rawEmail);
    if (!email) throw new Error(`ADMIN_EMAIL is not an email address: ${rawEmail}`);
    const user = await this.#users.findByEmail(email);
    if (!user) {
      await this.#users.create({ email, role: 'admin', locale: 'fr', invitedBy: null, invitedAt: this.#clock.now() });
      return;
    }
    if (user.role !== 'admin') await this.#users.setRole(user.id, 'admin');
    if (user.revokedAt) await this.#users.restore(user.id);
  }
}
