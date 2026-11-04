import { personNameOf, type Locale, type PersonDto, type UserRole, type UserStatus } from '@open-agent/shared';

/** Someone the admin gave access to. Revoking keeps the row (and later their conversations): access can come back. */
export type User = {
  id: number;
  email: string;
  role: UserRole;
  /** The language of their last sign-in request: emails and, later, answers use it. */
  locale: Locale;
  invitedAt: Date;
  lastSignInAt: Date | null;
  revokedAt: Date | null;
  /** In USD per calendar month; `null`: the default quota. Admins have none, whatever this says. */
  monthlyQuotaUsd: number | null;
  /** Their own OpenRouter key: it pays for their calls, which then no longer count against the quota. */
  ownKey: OwnKey | null;
};

/** Encrypted at rest; only `SecretBox` reads it back. */
export type OwnKey = { sealed: string; addedAt: Date };

export function userStatus(user: User): UserStatus {
  if (user.revokedAt) return 'revoked';
  return user.lastSignInAt ? 'active' : 'invited';
}

/** How the others see them: in a shared conversation, the people dialog, an email. */
export function personOf(user: User): PersonDto {
  return { id: user.id, name: personNameOf(user.email), email: user.email };
}
