import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';

import {
  NotAWebPage,
  PageUnavailable,
  type WebPage,
  type WebPageReader,
} from '../../application/ports/context-services.ts';
import { fetchPublic, readCapped } from './public-fetch.ts';

/**
 * Past this it is a download, not a page. The model reads up to 200,000 characters of a page: a long article's HTML
 * weighs several times its text (scripts, styles, markup), 3 MB cut some before that.
 */
const MAX_BYTES = 10 * 1024 * 1024;
const TIMEOUT_MS = 15_000;
const READABLE_TYPES: Record<string, true> = { 'text/html': true, 'application/xhtml+xml': true, 'text/plain': true };

/** Fetches a page the user gave and keeps its readable text, as Firefox's reader view does. */
export class ReadableWebPageReader implements WebPageReader {
  async read(url: string, abortSignal: AbortSignal): Promise<WebPage> {
    const { response, url: address } = await fetchPublic(url, abortSignal, 'text/html,text/plain', TIMEOUT_MS);
    const type = (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    if (!READABLE_TYPES[type]) {
      await response.body?.cancel();
      throw new NotAWebPage(type);
    }
    const body = new TextDecoder().decode(await readCapped(response, MAX_BYTES, 'The page is too big to read.'));
    return type === 'text/plain' ? { url: address.toString(), title: null, text: tidy(body) } : readable(address, body);
  }
}

/** Below this, Readability most likely kept a menu or a banner instead of the page's content. */
const ARTICLE_MIN_CHARACTERS = 1000;

/**
 * The page's main text, as the reader view finds it; when that finds almost nothing (pages built of many small
 * blocks, like service-public.fr), the whole text without scripts, menus and forms.
 */
function readable(url: URL, html: string): WebPage {
  const { document } = parseHTML(html);
  const title = document.title?.trim() || null;
  // Readability changes the document it reads: the whole text is taken first.
  for (const node of document.querySelectorAll('script, style, noscript, template, svg, nav, form')) node.remove();
  const whole = tidy(document.body?.textContent ?? '');
  // linkedom's document has what Readability reads; the server has no DOM types to say so.
  const article = new Readability(document as unknown as ConstructorParameters<typeof Readability>[0]).parse();
  const main = tidy(article?.textContent ?? '');
  const text = main.length >= ARTICLE_MIN_CHARACTERS || main.length >= whole.length ? main : whole;
  if (!text) throw new PageUnavailable('The page has no text to read (it may need JavaScript).');
  return { url: url.toString(), title: article?.title?.trim() || title, text };
}

/** One space between words, one blank line between paragraphs. */
function tidy(text: string): string {
  return text
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
