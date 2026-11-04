import { API_ROUTES, type ListCommandsResponse } from '@open-agent/shared';
import { queryOptions } from '@tanstack/react-query';

import { apiOrThrow } from '@/lib/api.ts';

/** The user's commands, most used first: the composer's buttons and "/" list follow this order. */
export const commandsQuery = queryOptions({
  queryKey: [API_ROUTES.commands],
  queryFn: async () => (await apiOrThrow<ListCommandsResponse>(API_ROUTES.commands)).commands,
});
