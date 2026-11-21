import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

import { PageUnavailable } from '../../application/ports/context-services.ts';

const MAX_REDIRECTS = 5;

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
 * A link the user or the model gave, fetched for the model: every address, redirects included, must be public. The
 * name is resolved again by `fetch`: a domain switching to a private address in between (DNS rebinding) is not
 * caught, an accepted risk for a private app. `timeoutMs` also bounds reading the body.
 */
export async function fetchPublic(
  url: string,
  abortSignal: AbortSignal,
  accept: string,
  timeoutMs: number,
): Promise<{ response: Response; url: URL }> {
  const signal = AbortSignal.any([abortSignal, AbortSignal.timeout(timeoutMs)]);
  let address = parseUrl(url);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublic(address);
    const response = await fetch(address, {
      redirect: 'manual',
      signal,
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; OpenAgent/1.0)', accept },
    });
    const location = response.headers.get('location');
    if (response.status >= 300 && response.status < 400 && location) {
      address = parseUrl(new URL(location, address).toString());
      continue;
    }
    if (!response.ok) throw new PageUnavailable(`The link answered ${response.status}.`);
    return { response, url: address };
  }
  throw new PageUnavailable('The link redirects too many times.');
}

/** The body, refused past `maxBytes` without reading the rest. */
export async function readCapped(response: Response, maxBytes: number, tooBig: string): Promise<Uint8Array> {
  const reader = response.body!.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new PageUnavailable(tooBig);
    }
    chunks.push(value);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

function parseUrl(text: string): URL {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new PageUnavailable('This is not a web address.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new PageUnavailable('Only web links can be read.');
  if (url.port && url.port !== '80' && url.port !== '443') throw new PageUnavailable('Only web links can be read.');
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
