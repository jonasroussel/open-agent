import type { Mailer, SignInEmail } from '../../application/ports/mailer.ts';
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

  async sendSignIn(email: SignInEmail): Promise<void> {
    const { subject, html } = renderSignInEmail(email);
    const response = await fetch(PLUNK_SEND_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.#apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ to: email.to, subject, body: html, from: { name: 'Open Agent', email: this.#from } }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Plunk answered ${response.status}: ${await response.text()}`);
  }
}
