import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';

import { PageUnavailable, type WebPage, type WebPageReader } from '../../application/ports/context-services.ts';

/** A web page is a few hundred kB; past this it is a download, not a page. */
const MAX_BYTES = 3 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const READABLE_TYPES: Record<string, true> = { 'text/html': true, 'application/xhtml+xml': true, 'text/plain': true };

/**
 * Addresses of the server's own network, never fetched: a link to them would let anyone read what only the server
 * can reach (SearXNG, the Docker host, the cloud's metadata service).
 */
const PRIVATE = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['224.0.0.0', 3],
] as const) {
  PRIVATE.addSubnet(network, prefix, 'ipv4');
}
// IPv4-mapped addresses (`::ffff:10.0.0.1`) are checked against the IPv4 rules by `BlockList` itself: a rule for
// `::ffff:0:0/96` would block every IPv4 address.
for (const [network, prefix] of [
  ['::', 127],
  ['64:ff9b::', 96],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  PRIVATE.addSubnet(network, prefix, 'ipv6');
}

/**
 * Fetches a page the user gave and keeps its readable text, as Firefox's reader view does. Every address, redirects
 * included, must be public. The name is resolved again by `fetch`: a domain switching to a private address in
 * between (DNS rebinding) is not caught, an accepted risk for a private app.
 */
export class ReadableWebPageReader implements WebPageReader {
  async read(url: string, abortSignal: AbortSignal): Promise<WebPage> {
    const signal = AbortSignal.any([abortSignal, AbortSignal.timeout(15_000)]);
    let address = parseUrl(url);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      await assertPublic(address);
      const response = await fetch(address, {
        redirect: 'manual',
        signal,
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; OpenAgent/1.0)', accept: 'text/html,text/plain' },
      });
      const location = response.headers.get('location');
      if (response.status >= 300 && response.status < 400 && location) {
        address = parseUrl(new URL(location, address).toString());
        continue;
      }
      if (!response.ok) throw new PageUnavailable(`The page answered ${response.status}.`);
      const type = (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
      if (!READABLE_TYPES[type]) throw new PageUnavailable(`This link is not a web page (${type || 'unknown type'}).`);
      const body = await readCapped(response);
      return type === 'text/plain'
        ? { url: address.toString(), title: null, text: tidy(body) }
        : readable(address, body);
    }
    throw new PageUnavailable('The page redirects too many times.');
  }
}

function parseUrl(text: string): URL {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new PageUnavailable('This is not a web address.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new PageUnavailable('Only web pages can be read.');
  if (url.port && url.port !== '80' && url.port !== '443') throw new PageUnavailable('Only web pages can be read.');
  if (url.username || url.password) throw new PageUnavailable('Links with a password cannot be read.');
  return url;
}

async function assertPublic(url: URL): Promise<void> {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host)
    ? [{ address: host, family: isIP(host) }]
    : await lookup(host, { all: true }).catch(() => {
        throw new PageUnavailable('This site does not exist.');
      });
  for (const { address, family } of addresses) {
    if (PRIVATE.check(address, family === 6 ? 'ipv6' : 'ipv4')) throw new PageUnavailable('This address is private.');
  }
}

async function readCapped(response: Response): Promise<string> {
  const reader = response.body!.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel();
      throw new PageUnavailable('The page is too big to read.');
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
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
