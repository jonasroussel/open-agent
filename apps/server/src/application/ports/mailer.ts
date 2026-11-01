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

export interface Mailer {
  /** Throws when the email could not be handed over for delivery. */
  sendSignIn(email: SignInEmail): Promise<void>;
}
