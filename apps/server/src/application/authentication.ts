import { normalizeEmail, SIGN_IN_LINK_PATH, type Locale } from '@open-agent/shared';

import type { UserRepository } from '../domain/user-repository.ts';
import type { User } from '../domain/user.ts';
import type { Clock } from './ports/clock.ts';
import type { LoginAttemptLimiter } from './ports/login-attempt-limiter.ts';
import type { Mailer } from './ports/mailer.ts';
import type { SessionStore } from './ports/session-store.ts';
import type { SignInRequestStore } from './ports/sign-in-request-store.ts';

export const SIGN_IN_LINK_MINUTES = 15;
/** Family members sign in once per device, about twice a year. */
const SESSION_DAYS = 180;

export type SignInRequestResult =
  | { ok: true }
  | { ok: false; reason: 'invalid_request' | 'too_many_attempts' | 'email_failed' };

export type SignInResult =
  | { ok: true; user: User; token: string; expiresAt: Date }
  | { ok: false; reason: 'invalid_sign_in' | 'too_many_attempts' };

/** Builds the link of an emailed sign-in; the client page posts its token back. */
export function signInLink(publicUrl: string, token: string): string {
  const url = new URL(SIGN_IN_LINK_PATH, publicUrl);
  url.searchParams.set('token', token);
  return url.toString();
}

/**
 * Passwordless: an invited address receives a link and a code. Unknown and revoked addresses get the same answer
 * and no email, so the sign-in form never tells who is invited.
 */
export class Authentication {
  readonly #users: UserRepository;
  readonly #sessions: SessionStore;
  readonly #signInRequests: SignInRequestStore;
  readonly #mailer: Mailer;
  /** Emails sent per address and per network address: stops anyone from flooding an inbox (and the Plunk bill). */
  readonly #requestLimiter: LoginAttemptLimiter;
  /** Wrong codes: a 6-digit code must not be guessable within its 15 minutes. */
  readonly #codeLimiter: LoginAttemptLimiter;
  readonly #clock: Clock;
  readonly #publicUrl: string;
  /** Development only (`null` in production): a fixed code that signs in any invited user, to test on other devices. */
  readonly #devSignInCode: string | null;

  constructor(
    users: UserRepository,
    sessions: SessionStore,
    signInRequests: SignInRequestStore,
    mailer: Mailer,
    requestLimiter: LoginAttemptLimiter,
    codeLimiter: LoginAttemptLimiter,
    clock: Clock,
    publicUrl: string,
    devSignInCode: string | null,
  ) {
    this.#users = users;
    this.#sessions = sessions;
    this.#signInRequests = signInRequests;
    this.#mailer = mailer;
    this.#requestLimiter = requestLimiter;
    this.#codeLimiter = codeLimiter;
    this.#clock = clock;
    this.#publicUrl = publicUrl;
    this.#devSignInCode = devSignInCode;
  }

  async requestSignIn(rawEmail: string, locale: Locale, clientAddress: string): Promise<SignInRequestResult> {
    const email = normalizeEmail(rawEmail);
    if (!email) return { ok: false, reason: 'invalid_request' };
    const now = this.#clock.now();
    const keys = [`email:${email}`, `address:${clientAddress}`];
    if (this.#requestLimiter.isBlocked(keys, now)) return { ok: false, reason: 'too_many_attempts' };
    this.#requestLimiter.recordFailure(keys, now);

    const user = await this.#users.findByEmail(email);
    if (!user || user.revokedAt) return { ok: true };

    await this.#users.setLocale(user.id, locale);
    const { token, code } = await this.#signInRequests.create({
      userId: user.id,
      expiresAt: new Date(now.getTime() + SIGN_IN_LINK_MINUTES * 60_000),
      withCode: true,
      now,
    });
    try {
      await this.#mailer.sendSignIn({
        to: user.email,
        locale,
        kind: 'sign_in',
        link: signInLink(this.#publicUrl, token),
        code,
        validForMinutes: SIGN_IN_LINK_MINUTES,
      });
      return { ok: true };
    } catch (error) {
      console.error('Sign-in email failed:', error);
      return { ok: false, reason: 'email_failed' };
    }
  }

  async signInWithToken(token: string): Promise<SignInResult> {
    const now = this.#clock.now();
    const userId = await this.#signInRequests.useToken(token, now);
    const user = userId === null ? null : await this.#users.findById(userId);
    return user && !user.revokedAt ? this.#openSession(user, now) : { ok: false, reason: 'invalid_sign_in' };
  }

  async signInWithCode(rawEmail: string, code: string, clientAddress: string): Promise<SignInResult> {
    const email = normalizeEmail(rawEmail);
    const now = this.#clock.now();
    const keys = [`email:${email}`, `address:${clientAddress}`];
    if (this.#codeLimiter.isBlocked(keys, now)) return { ok: false, reason: 'too_many_attempts' };

    const user = email ? await this.#users.findByEmail(email) : null;
    const accepted =
      user !== null &&
      !user.revokedAt &&
      (code.trim() === this.#devSignInCode || (await this.#signInRequests.useCode(user.id, code.trim(), now)));
    if (!accepted) {
      this.#codeLimiter.recordFailure(keys, now);
      return { ok: false, reason: 'invalid_sign_in' };
    }
    this.#codeLimiter.clear(`email:${email}`);
    return this.#openSession(user, now);
  }

  /** `null` when signed out, expired, or revoked: a revocation ends access at the next request. */
  async signedInUser(token: string | null): Promise<User | null> {
    const now = this.#clock.now();
    const userId = token ? await this.#sessions.findUserId(token, now) : null;
    const user = userId === null ? null : await this.#users.findById(userId);
    return user && !user.revokedAt ? user : null;
  }

  async signOut(token: string | null): Promise<void> {
    if (token) await this.#sessions.delete(token);
  }

  async #openSession(user: User, now: Date): Promise<SignInResult> {
    const expiresAt = new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60_000);
    const token = await this.#sessions.create(user.id, expiresAt, now);
    await this.#users.recordSignIn(user.id, now);
    return { ok: true, user: { ...user, lastSignInAt: now }, token, expiresAt };
  }
}
