import { describe, expect, test } from 'bun:test';

import { PublicFileDownloader } from './public-file-downloader.ts';

const download = (url: string) => new PublicFileDownloader().download(url, new AbortController().signal);

describe('PublicFileDownloader', () => {
  test("never fetches the server's own network, nor anything but a web link", async () => {
    await expect(download('http://127.0.0.1/admin')).rejects.toThrow('This address is private.');
    await expect(download('http://169.254.169.254/latest/meta-data/')).rejects.toThrow('This address is private.');
    await expect(download('http://[::ffff:10.0.0.1]/x.pdf')).rejects.toThrow('This address is private.');
    await expect(download('file:///etc/passwd')).rejects.toThrow('Only web links can be read.');
    await expect(download('https://example.org:8443/x.pdf')).rejects.toThrow('Only web links can be read.');
  });
});
