import { createTransport, type Transporter } from 'nodemailer';

import type { Mailer, ShareEmail, SignInEmail } from '../../application/ports/mailer.ts';
import { renderShareEmail } from './share-email.ts';
import { renderSignInEmail } from './sign-in-email.ts';

export type SmtpSettings = {
  host: string;
  /** 465: TLS from the start. Any other port (587) upgrades with STARTTLS. */
  port: number;
  /** Both or neither: a relay that needs no sign-in, inside a private network. */
  user: string | null;
  password: string | null;
  /** The sender's address: the server must allow it for `user` (Proton: an address of the account). */
  from: string;
};

/** Any SMTP server, e.g. Proton Mail's (`smtp.protonmail.ch:587`, with an SMTP token as the password). */
export class SmtpMailer implements Mailer {
  readonly #transport: Transporter;
  readonly #from: string;

  constructor({ host, port, user, password, from }: SmtpSettings) {
    const auth = user && password ? { user, pass: password } : undefined;
    this.#transport = createTransport({
      host,
      port,
      secure: port === 465,
      // A password never travels in clear: without STARTTLS the server is refused.
      requireTLS: auth !== undefined,
      auth,
      connectionTimeout: 15_000,
      socketTimeout: 15_000,
    });
    this.#from = from;
  }

  sendSignIn(email: SignInEmail): Promise<void> {
    return this.#send(email.to, renderSignInEmail(email));
  }

  sendShare(email: ShareEmail): Promise<void> {
    return this.#send(email.to, renderShareEmail(email));
  }

  async #send(to: string, { subject, html }: { subject: string; html: string }): Promise<void> {
    await this.#transport.sendMail({ from: { name: 'Open Agent', address: this.#from }, to, subject, html });
  }
}
