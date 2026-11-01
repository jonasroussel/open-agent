import { API_ROUTES, type ListMemoryRulesResponse } from '@open-agent/shared';
import { queryOptions } from '@tanstack/react-query';

import { apiOrThrow } from '@/lib/api.ts';

export const memoryRulesQuery = queryOptions({
  queryKey: [API_ROUTES.memoryRules],
  queryFn: async () => (await apiOrThrow<ListMemoryRulesResponse>(API_ROUTES.memoryRules)).rules,
});
