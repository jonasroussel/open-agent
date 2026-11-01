import type { Locale } from '@open-agent/shared';

import type { WebSearch, WebSearchRequest, WebSearchResponse } from '../../application/ports/web-search.ts';

const LANGUAGE: Record<Locale, string> = { fr: 'fr-FR', en: 'en' };
const MAX_RESULTS = 5;

type SearxngResult = { title: string; url: string; content?: string; publishedDate?: string | null };

/**
 * Our own SearXNG container: free, but only titles and short snippets. Its settings must allow the `json` format and
 * keep the limiter off, as it is only reachable from this server.
 */
export class SearxngSearch implements WebSearch {
  readonly #baseUrl: string;

  constructor(baseUrl: string) {
    this.#baseUrl = baseUrl.replace(/\/$/, '');
  }

  async search(request: WebSearchRequest, abortSignal: AbortSignal): Promise<WebSearchResponse> {
    const recentResults = request.recent ? await this.#query(request, 'week', abortSignal) : [];
    // Few engines date their pages: a recent search that finds nothing searches again without the date filter.
    const results = recentResults.length > 0 ? recentResults : await this.#query(request, null, abortSignal);
    return {
      provider: 'searxng',
      results: results.slice(0, MAX_RESULTS).map((result) => ({
        title: result.title,
        url: result.url,
        content: result.content ?? '',
        publishedAt: result.publishedDate ?? null,
      })),
    };
  }

  async #query(
    request: WebSearchRequest,
    timeRange: 'week' | null,
    abortSignal: AbortSignal,
  ): Promise<SearxngResult[]> {
    const url = new URL(`${this.#baseUrl}/search`);
    url.search = new URLSearchParams({
      q: request.query,
      format: 'json',
      language: LANGUAGE[request.locale],
      safesearch: '1',
      ...(timeRange ? { time_range: timeRange } : {}),
    }).toString();
    const response = await fetch(url, { signal: AbortSignal.any([abortSignal, AbortSignal.timeout(10_000)]) });
    if (!response.ok) throw new Error(`SearXNG answered ${response.status}: ${await response.text()}`);
    const { results } = (await response.json()) as { results: SearxngResult[] };
    return results;
  }
}
