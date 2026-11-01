import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createStaticFiles } from './static-files.ts';

let base: string;
let staticFiles: (request: Request) => Promise<Response>;
const get = (path: string) => staticFiles(new Request(`http://localhost${path}`));

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), 'open-agent-static-'));
  mkdirSync(join(base, 'dist/assets'), { recursive: true });
  writeFileSync(join(base, 'dist/index.html'), 'index');
  writeFileSync(join(base, 'dist/assets/app-1a2b.js'), 'app');
  writeFileSync(join(base, 'secret.txt'), 'secret');
  staticFiles = createStaticFiles(join(base, 'dist'));
});

afterAll(() => rmSync(base, { recursive: true, force: true }));

describe('createStaticFiles', () => {
  test('never serves a file outside the client folder', async () => {
    const response = await get('/%2e%2e/secret.txt');
    expect(await response.text()).toBe('index');
  });

  test('caches hashed assets for good, but always rechecks index.html', async () => {
    expect((await get('/assets/app-1a2b.js')).headers.get('cache-control')).toContain('immutable');
    expect((await get('/c/42')).headers.get('cache-control')).toBe('no-cache');
  });

  test('answers index.html for client routes, so a reload on any page works', async () => {
    expect(await (await get('/c/42')).text()).toBe('index');
  });
});
