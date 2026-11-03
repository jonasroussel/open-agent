import {
  API_ROUTES,
  apiPath,
  type ConversationResponse,
  type ListConversationsResponse,
  type UpdateConversationBody,
} from '@open-agent/shared';
import { queryOptions, type QueryClient } from '@tanstack/react-query';

import { api, apiOrThrow } from '@/lib/api.ts';

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

/** Renames a conversation, then the sidebar and the top bar show its new title. */
export async function renameConversation(queryClient: QueryClient, id: string, title: string): Promise<void> {
  await api(apiPath(API_ROUTES.conversation, { conversationId: id }), {
    method: 'PATCH',
    body: { title } satisfies UpdateConversationBody,
  });
  await queryClient.invalidateQueries({ queryKey: conversationsQuery.queryKey });
}
