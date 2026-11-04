import type { Mailer, ShareEmail, SignInEmail } from '../../application/ports/mailer.ts';

/** Development without `PLUNK_API_KEY`: the link and code go to the server log instead of an inbox. */
export class ConsoleMailer implements Mailer {
  async sendSignIn(email: SignInEmail): Promise<void> {
    console.log(`[mail] ${email.kind} for ${email.to}: ${email.link}${email.code ? ` (code ${email.code})` : ''}`);
  }

  async sendShare(email: ShareEmail): Promise<void> {
    console.log(`[mail] ${email.from} shares "${email.title ?? ''}" with ${email.to}: ${email.link}`);
  }
}
