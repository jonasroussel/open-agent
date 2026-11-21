import { MAX_FILE_BYTES } from '@open-agent/shared';

import { PageUnavailable, type DownloadedFile, type FileDownloader } from '../../application/ports/context-services.ts';
import { fetchPublic, readCapped } from './public-fetch.ts';

/** 50 MB at the server's bandwidth, with room for a slow site. */
const TIMEOUT_MS = 60_000;
const TOO_BIG = `The file is over ${MAX_FILE_BYTES / 1024 / 1024} MB: it cannot be read.`;

/** A file at a public link, with the same rules as a page: public addresses only, a few redirects, a timeout. */
export class PublicFileDownloader implements FileDownloader {
  async download(url: string, abortSignal: AbortSignal): Promise<DownloadedFile> {
    const { response, url: address } = await fetchPublic(url, abortSignal, '*/*', TIMEOUT_MS);
    if (Number(response.headers.get('content-length')) > MAX_FILE_BYTES) {
      await response.body?.cancel();
      throw new PageUnavailable(TOO_BIG);
    }
    const bytes = await readCapped(response, MAX_FILE_BYTES, TOO_BIG);
    return {
      url: address.toString(),
      name: nameOf(response.headers.get('content-disposition') ?? '', address),
      mediaType: response.headers.get('content-type') ?? '',
      bytes,
    };
  }
}

/** The name the site gives (`filename*` first, as RFC 6266 says), else the link's last segment. */
function nameOf(disposition: string, address: URL): string {
  const encoded = /filename\*\s*=\s*[\w-]+'[^']*'([^;]+)/i.exec(disposition)?.[1];
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(disposition)?.[1];
  const segment = address.pathname.split('/').pop();
  for (const candidate of [encoded, plain, segment]) {
    if (!candidate?.trim()) continue;
    try {
      return decodeURIComponent(candidate.trim());
    } catch {
      return candidate.trim();
    }
  }
  return address.hostname;
}
