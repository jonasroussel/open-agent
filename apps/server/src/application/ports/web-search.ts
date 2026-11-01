import type { Locale, WebResult, WebSearchInput } from '@open-agent/shared';

export type WebSearchRequest = WebSearchInput & { locale: Locale };

export type WebSearchResponse = {
  /** Which service answered, kept in the usage ledger. */
  provider: string;
  results: WebResult[];
};

export interface WebSearch {
  /** Throws when no service could answer. */
  search(request: WebSearchRequest, abortSignal: AbortSignal): Promise<WebSearchResponse>;
}

/** The service's searches for this month are used up. */
export class SearchQuotaExhausted extends Error {}
