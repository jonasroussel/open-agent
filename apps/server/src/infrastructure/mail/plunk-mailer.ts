import type { Mailer, ShareEmail, SignInEmail } from '../../application/ports/mailer.ts';
import { renderShareEmail } from './share-email.ts';
import { renderSignInEmail } from './sign-in-email.ts';

const PLUNK_SEND_URL = 'https://next-api.useplunk.com/v1/send';

/** Plunk's transactional API. The sender's domain must be verified in Plunk. */
export class PlunkMailer implements Mailer {
  readonly #apiKey: string;
  readonly #from: string;

  constructor(apiKey: string, from: string) {
    this.#apiKey = apiKey;
    this.#from = from;
  }

  sendSignIn(email: SignInEmail): Promise<void> {
    return this.#send(email.to, renderSignInEmail(email));
  }

  sendShare(email: ShareEmail): Promise<void> {
    return this.#send(email.to, renderShareEmail(email));
  }

  async #send(to: string, { subject, html }: { subject: string; html: string }): Promise<void> {
    const response = await fetch(PLUNK_SEND_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.#apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ to, subject, body: html, from: { name: 'Open Agent', email: this.#from } }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Plunk answered ${response.status}: ${await response.text()}`);
  }
}
