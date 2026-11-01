import { API_ROUTES, apiPath, type ConversationResponse, type ListConversationsResponse } from '@open-agent/shared';
import { queryOptions } from '@tanstack/react-query';

import { apiOrThrow } from '@/lib/api.ts';

export const conversationsQuery = queryOptions({
  queryKey: [API_ROUTES.conversations],
  queryFn: async () => (await apiOrThrow<ListConversationsResponse>(API_ROUTES.conversations)).conversations,
});

export const conversationQuery = (id: string) =>
  queryOptions({
    queryKey: [API_ROUTES.conversations, id],
    queryFn: () => apiOrThrow<ConversationResponse>(apiPath(API_ROUTES.conversation, { conversationId: id })),
    // Opened once to build its `Chat`; from then on the `Chat` holds the messages.
    staleTime: Infinity,
    // A deleted or foreign conversation answers 404: go back to the empty page at once instead of retrying.
    retry: false,
  });
