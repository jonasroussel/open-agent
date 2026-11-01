import type { Clock } from '../../application/ports/clock.ts';
import {
  SearchQuotaExhausted,
  type WebSearch,
  type WebSearchRequest,
  type WebSearchResponse,
} from '../../application/ports/web-search.ts';

/**
 * Asks each service in turn until one answers. A service whose month is used up is skipped until the 1st of next
 * month (UTC), so the users do not wait for a refusal on every search.
 */
export class FallbackWebSearch implements WebSearch {
  readonly #services: readonly WebSearch[];
  readonly #clock: Clock;
  readonly #exhaustedUntil = new Map<WebSearch, Date>();

  constructor(services: readonly WebSearch[], clock: Clock) {
    this.#services = services;
    this.#clock = clock;
  }

  async search(request: WebSearchRequest, abortSignal: AbortSignal): Promise<WebSearchResponse> {
    let lastError: unknown = new Error('Every web search service is used up this month.');
    for (const service of this.#services) {
      const exhaustedUntil = this.#exhaustedUntil.get(service);
      if (exhaustedUntil && this.#clock.now() < exhaustedUntil) continue;
      try {
        return await service.search(request, abortSignal);
      } catch (error) {
        if (abortSignal.aborted) throw error;
        if (error instanceof SearchQuotaExhausted)
          this.#exhaustedUntil.set(service, startOfNextMonth(this.#clock.now()));
        console.error('Web search failed, trying the next service:', error);
        lastError = error;
      }
    }
    throw lastError;
  }
}

function startOfNextMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
}
