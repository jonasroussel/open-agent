import type { Locale, UserRole } from '@open-agent/shared';

import type { User } from './user.ts';

export type NewUser = { email: string; role: UserRole; locale: Locale; invitedBy: number | null; invitedAt: Date };

export interface UserRepository {
  findById(id: number): Promise<User | null>;
  /** `email` is already normalized. */
  findByEmail(email: string): Promise<User | null>;
  /** Oldest first. */
  list(): Promise<User[]>;
  create(user: NewUser): Promise<User>;
  setRole(id: number, role: UserRole): Promise<void>;
  setLocale(id: number, locale: Locale): Promise<void>;
  recordSignIn(id: number, at: Date): Promise<void>;
  revoke(id: number, at: Date): Promise<void>;
  /** Clears a revocation. */
  restore(id: number): Promise<void>;
  setMonthlyQuota(id: number, usd: number): Promise<void>;
}
