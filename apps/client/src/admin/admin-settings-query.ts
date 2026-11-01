import { API_ROUTES, type AdminSettingsResponse, type ListModelsResponse } from '@open-agent/shared';
import { queryOptions } from '@tanstack/react-query';

import { apiOrThrow } from '@/lib/api.ts';

export const adminSettingsQuery = queryOptions({
  queryKey: [API_ROUTES.adminSettings],
  queryFn: () => apiOrThrow<AdminSettingsResponse>(API_ROUTES.adminSettings),
});

/** OpenRouter's list: a few hundred models, refreshed by the server every hour. */
export const adminModelsQuery = queryOptions({
  queryKey: [API_ROUTES.adminModels],
  queryFn: async () => (await apiOrThrow<ListModelsResponse>(API_ROUTES.adminModels)).models,
  staleTime: 60 * 60 * 1000,
});
