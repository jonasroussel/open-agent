import { API_ROUTES, type QuotaResponse } from '@open-agent/shared';
import { queryOptions } from '@tanstack/react-query';

import { apiOrThrow } from '@/lib/api.ts';

export const quotaQuery = queryOptions({
  queryKey: [API_ROUTES.quota],
  queryFn: () => apiOrThrow<QuotaResponse>(API_ROUTES.quota),
});

/** From this share on, the chat says how much is left: running out should never be a surprise. */
export const QUOTA_WARNING_PERCENT = 80;

/** "décembre": a quota always comes back on the 1st, so the sentences only need the month. */
export function resetMonth(quota: QuotaResponse, language: string): string {
  return new Intl.DateTimeFormat(language, { month: 'long', timeZone: 'Europe/Paris' }).format(
    new Date(quota.resetsAt),
  );
}
