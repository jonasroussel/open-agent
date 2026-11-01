import type { Locale, UserRole, UserStatus } from '@open-agent/shared';

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
};

export function userStatus(user: User): UserStatus {
  if (user.revokedAt) return 'revoked';
  return user.lastSignInAt ? 'active' : 'invited';
}
