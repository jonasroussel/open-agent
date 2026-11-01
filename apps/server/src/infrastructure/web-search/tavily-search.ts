import type { Locale } from '@open-agent/shared';

import {
  SearchQuotaExhausted,
  type WebSearch,
  type WebSearchRequest,
  type WebSearchResponse,
} from '../../application/ports/web-search.ts';

const TAVILY_SEARCH_URL = 'https://api.tavily.com/search';
/** Tavily's free plan stops with 432 when the month's credits are used; 433 is the pay-as-you-go cap. */
const QUOTA_STATUSES = new Set([432, 433]);
/** `country` only applies to general searches. English speakers may live anywhere. */
const COUNTRY: Record<Locale, string | null> = { fr: 'france', en: null };

type TavilyResult = { title: string; url: string; content: string; published_date?: string | null };

/** Tavily: page extracts ready for a model. Free plan: 1,000 basic searches a month. */
export class TavilySearch implements WebSearch {
  readonly #apiKey: string;

  constructor(apiKey: string) {
    this.#apiKey = apiKey;
  }

  async search(request: WebSearchRequest, abortSignal: AbortSignal): Promise<WebSearchResponse> {
    const country = COUNTRY[request.locale];
    const response = await fetch(TAVILY_SEARCH_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.#apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        query: request.query,
        search_depth: 'basic',
        max_results: 5,
        language: request.locale,
        safe_search: true,
        include_published_date: true,
        ...(request.recent
          ? { topic: 'news', time_range: 'week' }
          : { topic: 'general', ...(country ? { country } : {}) }),
      }),
      signal: AbortSignal.any([abortSignal, AbortSignal.timeout(15_000)]),
    });
    if (QUOTA_STATUSES.has(response.status)) throw new SearchQuotaExhausted(await response.text());
    if (!response.ok) throw new Error(`Tavily answered ${response.status}: ${await response.text()}`);
    const { results } = (await response.json()) as { results: TavilyResult[] };
    return {
      provider: 'tavily',
      results: results.map((result) => ({
        title: result.title,
        url: result.url,
        content: result.content,
        publishedAt: result.published_date ?? null,
      })),
    };
  }
}
