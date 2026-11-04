import {
  API_ROUTES,
  apiPath,
  type ConversationResponse,
  type ListConversationsResponse,
  type ListPeopleResponse,
  type ShareConversationBody,
  type UpdateConversationBody,
} from '@open-agent/shared';
import { queryOptions, type QueryClient } from '@tanstack/react-query';

import { api, apiOrThrow } from '@/lib/api.ts';

import { setAnswering } from './answering-store.ts';

/** The user's conversations, their own and those they joined, with the invitations they have not answered. */
export const conversationsQuery = queryOptions({
  queryKey: [API_ROUTES.conversations],
  queryFn: () => apiOrThrow<ListConversationsResponse>(API_ROUTES.conversations),
});

export const conversationQuery = (id: string) =>
  queryOptions({
    queryKey: [API_ROUTES.conversations, id],
    queryFn: async () => {
      const response = await apiOrThrow<ConversationResponse>(apiPath(API_ROUTES.conversation, { conversationId: id }));
      setAnswering(id, response.answering);
      return response;
    },
    // Opened once to build its `Chat`; from then on the `Chat` holds the messages.
    staleTime: Infinity,
    // A deleted or foreign conversation answers 404: go back to the empty page at once instead of retrying.
    retry: false,
  });

/** The people a conversation can be shared with. */
export const peopleQuery = queryOptions({
  queryKey: [API_ROUTES.people],
  queryFn: async () => (await apiOrThrow<ListPeopleResponse>(API_ROUTES.people)).people,
});

/** Renames a conversation, then the sidebar and the top bar show its new title. */
export async function renameConversation(queryClient: QueryClient, id: string, title: string): Promise<void> {
  await api(apiPath(API_ROUTES.conversation, { conversationId: id }), {
    method: 'PATCH',
    body: { title } satisfies UpdateConversationBody,
  });
  await queryClient.invalidateQueries({ queryKey: conversationsQuery.queryKey });
}

export async function inviteToConversation(queryClient: QueryClient, id: string, userIds: number[]): Promise<boolean> {
  const result = await api(apiPath(API_ROUTES.conversationMembers, { conversationId: id }), {
    method: 'POST',
    body: { userIds } satisfies ShareConversationBody,
  });
  await queryClient.invalidateQueries({ queryKey: conversationsQuery.queryKey });
  return result.ok;
}

export async function joinConversation(queryClient: QueryClient, id: string): Promise<boolean> {
  const result = await api(apiPath(API_ROUTES.conversationJoin, { conversationId: id }), { method: 'POST' });
  await queryClient.invalidateQueries({ queryKey: conversationsQuery.queryKey });
  return result.ok;
}

/** The owner removes someone; anyone else removes only themselves: they leave, or decline the invitation. */
export async function removeFromConversation(queryClient: QueryClient, id: string, userId: number): Promise<boolean> {
  const result = await api(apiPath(API_ROUTES.conversationMember, { conversationId: id, userId: String(userId) }), {
    method: 'DELETE',
  });
  await queryClient.invalidateQueries({ queryKey: conversationsQuery.queryKey });
  return result.ok;
}
