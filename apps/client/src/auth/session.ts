import { API_ROUTES, type SessionResponse, type SignedInUser } from '@open-agent/shared';
import { queryOptions } from '@tanstack/react-query';

import { api, ApiFailure } from '@/lib/api.ts';

/** The signed-in user, `null` when signed out. Sign-in and sign-out write it directly with `setQueryData`. */
export const sessionQuery = queryOptions({
  queryKey: ['session'],
  queryFn: async (): Promise<SignedInUser | null> => {
    const result = await api<SessionResponse>(API_ROUTES.session);
    if (result.ok) return result.data.user;
    if (result.error === 'not_signed_in') return null;
    throw new ApiFailure(result.error);
  },
  staleTime: Infinity,
});
