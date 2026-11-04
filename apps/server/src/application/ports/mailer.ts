import type { Locale } from '@open-agent/shared';

export type SignInEmail = {
  to: string;
  locale: Locale;
  /** `invitation`: the first email, sent by the admin. */
  kind: 'sign_in' | 'invitation';
  link: string;
  /** Only in `sign_in` emails: typed in the installed app, which the link cannot open on iOS. */
  code: string | null;
  validForMinutes: number;
};

/** Someone shared a conversation with the recipient; the link opens the invitation. */
export type ShareEmail = {
  to: string;
  locale: Locale;
  /** Who shared it, by name. */
  from: string;
  /** `null`: not named yet. */
  title: string | null;
  link: string;
};

export interface Mailer {
  /** Throws when the email could not be handed over for delivery. */
  sendSignIn(email: SignInEmail): Promise<void>;
  /** Throws when the email could not be handed over for delivery. */
  sendShare(email: ShareEmail): Promise<void>;
}
