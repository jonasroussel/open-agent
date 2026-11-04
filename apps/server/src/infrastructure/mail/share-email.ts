import type { Locale } from '@open-agent/shared';

import type { ShareEmail } from '../../application/ports/mailer.ts';
import { emailButton, emailHtml, escapeHtml } from './email-layout.ts';

type Texts = {
  subject: (from: string) => string;
  intro: (from: string, title: string) => string;
  untitled: string;
  button: string;
  outro: string;
};

const TEXTS: Record<Locale, Texts> = {
  fr: {
    subject: (from) => `${from} partage une conversation avec vous`,
    intro: (from, title) => `${from} vous invite à rejoindre la conversation « ${title} » sur Open Agent.`,
    untitled: 'Nouvelle conversation',
    button: 'Voir l’invitation',
    outro: 'Une fois dedans, vous lisez tout l’historique et vous pouvez écrire à l’assistant avec les autres.',
  },
  en: {
    subject: (from) => `${from} shares a conversation with you`,
    intro: (from, title) => `${from} invites you to join the conversation “${title}” on Open Agent.`,
    untitled: 'New conversation',
    button: 'See the invitation',
    outro: 'Once in, you read the whole history and can write to the assistant with the others.',
  },
};

export function renderShareEmail(email: ShareEmail): { subject: string; html: string } {
  const texts = TEXTS[email.locale];
  const from = escapeHtml(email.from);
  const html = emailHtml(
    email.locale,
    `<p style="margin:0 0 24px;font-size:16px;line-height:1.5">${texts.intro(from, escapeHtml(email.title ?? texts.untitled))}</p>
      ${emailButton(email.link, texts.button)}
      <p style="margin:24px 0 0;font-size:14px;color:#525252">${texts.outro}</p>`,
  );
  return { subject: texts.subject(email.from), html };
}
