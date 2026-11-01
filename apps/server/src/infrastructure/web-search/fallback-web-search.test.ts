import { describe, expect, test } from 'bun:test';

import { SearchQuotaExhausted, type WebSearch, type WebSearchRequest } from '../../application/ports/web-search.ts';
import { FallbackWebSearch } from './fallback-web-search.ts';

const request: WebSearchRequest = { query: 'prix du gazole', recent: true, locale: 'fr' };
const signal = new AbortController().signal;

function service(provider: string, failure: () => Error | null) {
  const fake = {
    calls: 0,
    search: async () => {
      fake.calls += 1;
      const error = failure();
      if (error) throw error;
      return { provider, results: [] };
    },
  } satisfies WebSearch & { calls: number };
  return fake;
}

describe('FallbackWebSearch', () => {
  test('a used-up service is skipped until the 1st of next month', async () => {
    const clock = { at: new Date('2026-11-20T10:00:00Z'), now: () => clock.at };
    let quotaLeft = false;
    const tavily = service('tavily', () => (quotaLeft ? null : new SearchQuotaExhausted('432')));
    const searxng = service('searxng', () => null);
    const search = new FallbackWebSearch([tavily, searxng], clock);

    expect((await search.search(request, signal)).provider).toBe('searxng');
    expect((await search.search(request, signal)).provider).toBe('searxng');
    expect(tavily.calls).toBe(1);

    clock.at = new Date('2026-12-01T00:00:00Z');
    quotaLeft = true;
    expect((await search.search(request, signal)).provider).toBe('tavily');
  });

  test('a service that fails for another reason is tried again on the next search', async () => {
    let down = true;
    const tavily = service('tavily', () => (down ? new Error('Tavily answered 500') : null));
    const searxng = service('searxng', () => null);
    const search = new FallbackWebSearch([tavily, searxng], { now: () => new Date('2026-11-20T10:00:00Z') });

    expect((await search.search(request, signal)).provider).toBe('searxng');
    down = false;
    expect((await search.search(request, signal)).provider).toBe('tavily');
  });

  test('fails when no service answers', async () => {
    const search = new FallbackWebSearch([service('tavily', () => new Error('Tavily answered 500'))], {
      now: () => new Date(),
    });
    await expect(search.search(request, signal)).rejects.toThrow('Tavily answered 500');
  });
});
