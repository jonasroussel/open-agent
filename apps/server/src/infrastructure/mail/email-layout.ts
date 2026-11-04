import type { Locale } from '@open-agent/shared';

/** The frame every email shares: the app's name, a card, and `content` inside. */
export function emailHtml(locale: Locale, content: string): string {
  return `<!doctype html>
<html lang="${locale}">
  <body style="margin:0;padding:24px;background:#f5f5f5;font-family:-apple-system,'Segoe UI',Roboto,sans-serif;color:#171717">
    <div style="max-width:480px;margin:0 auto;padding:32px;background:#ffffff;border-radius:16px">
      <h1 style="margin:0 0 16px;font-size:22px">Open Agent</h1>
      ${content}
    </div>
  </body>
</html>`;
}

export function emailButton(link: string, label: string): string {
  return `<a href="${escapeHtml(link)}" style="display:inline-block;padding:14px 28px;border-radius:999px;background-color:#2a2c6e;color:#ffffff;font-size:16px;font-weight:600;text-decoration:none">${escapeHtml(label)}</a>`;
}

export function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
