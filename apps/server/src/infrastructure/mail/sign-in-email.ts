import type { Locale } from '@open-agent/shared';

import type { SignInEmail } from '../../application/ports/mailer.ts';

type Texts = {
  subject: Record<SignInEmail['kind'], string>;
  intro: Record<SignInEmail['kind'], string>;
  button: string;
  code: string;
  validFor: (duration: string) => string;
  minutes: (count: number) => string;
  days: (count: number) => string;
  ignore: string;
};

const TEXTS: Record<Locale, Texts> = {
  fr: {
    subject: { sign_in: 'Votre connexion à Open Agent', invitation: 'Vous êtes invité sur Open Agent' },
    intro: {
      sign_in: 'Cliquez sur le bouton pour vous connecter à Open Agent.',
      invitation: 'Vous avez été invité à utiliser Open Agent, un assistant qui apprend votre façon de travailler.',
    },
    button: 'Se connecter',
    code: 'Ou tapez ce code dans l’application :',
    validFor: (duration) => `Valable ${duration}, une seule fois.`,
    minutes: (count) => `${count} minutes`,
    days: (count) => `${count} jours`,
    ignore: 'Vous n’avez rien demandé ? Ignorez cet email.',
  },
  en: {
    subject: { sign_in: 'Your Open Agent sign-in', invitation: 'You are invited to Open Agent' },
    intro: {
      sign_in: 'Click the button to sign in to Open Agent.',
      invitation: 'You have been invited to use Open Agent, an assistant that learns how you like to work.',
    },
    button: 'Sign in',
    code: 'Or type this code in the app:',
    validFor: (duration) => `Valid for ${duration}, once.`,
    minutes: (count) => `${count} minutes`,
    days: (count) => `${count} days`,
    ignore: 'Did not ask for this? Ignore this email.',
  },
};

export function renderSignInEmail(email: SignInEmail): { subject: string; html: string } {
  const texts = TEXTS[email.locale];
  const minutes = email.validForMinutes;
  const duration = minutes >= 24 * 60 ? texts.days(Math.round(minutes / (24 * 60))) : texts.minutes(minutes);
  const code = email.code
    ? `<p style="margin:24px 0 8px">${texts.code}</p>
       <p style="margin:0;font-size:32px;font-weight:700;letter-spacing:8px">${email.code}</p>`
    : '';

  const html = `<!doctype html>
<html lang="${email.locale}">
  <body style="margin:0;padding:24px;background:#f5f5f5;font-family:-apple-system,'Segoe UI',Roboto,sans-serif;color:#171717">
    <div style="max-width:480px;margin:0 auto;padding:32px;background:#ffffff;border-radius:16px">
      <h1 style="margin:0 0 16px;font-size:22px">Open Agent</h1>
      <p style="margin:0 0 24px;font-size:16px;line-height:1.5">${texts.intro[email.kind]}</p>
      <a href="${escapeHtml(email.link)}" style="display:inline-block;padding:14px 28px;border-radius:999px;background-color:#2a2c6e;color:#ffffff;font-size:16px;font-weight:600;text-decoration:none">${texts.button}</a>
      ${code}
      <p style="margin:24px 0 0;font-size:14px;color:#525252">${texts.validFor(duration)}</p>
      <p style="margin:8px 0 0;font-size:14px;color:#525252">${texts.ignore}</p>
    </div>
  </body>
</html>`;
  return { subject: texts.subject[email.kind], html };
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
