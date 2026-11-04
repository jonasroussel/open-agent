import {
  MAX_PERSON_NAME_LENGTH,
  personNameOf,
  type Locale,
  type PersonDto,
  type UserRole,
  type UserStatus,
} from '@open-agent/shared';

/** Someone the admin gave access to. Revoking keeps the row (and later their conversations): access can come back. */
export type User = {
  id: number;
  email: string;
  /** Given by the admin; `null`: the start of their email names them (`nameOf`). */
  name: string | null;
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

/** The name the others see, the one the admin gave, else the start of their email. */
export function nameOf(user: User): string {
  return user.name ?? personNameOf(user.email);
}

/** How the others see them: in a shared conversation, the people dialog, an email. */
export function personOf(user: User): PersonDto {
  return { id: user.id, name: nameOf(user), email: user.email };
}

/** A name the admin types: one line, trimmed; an empty one gives the email's back (`null`). */
export function cleanPersonName(raw: unknown): { ok: true; name: string | null } | { ok: false } {
  if (raw === null) return { ok: true, name: null };
  if (typeof raw !== 'string') return { ok: false };
  const name = raw.replaceAll(/\s+/g, ' ').trim();
  if (name.length > MAX_PERSON_NAME_LENGTH) return { ok: false };
  return { ok: true, name: name || null };
}
