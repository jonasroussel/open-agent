import {
  API_ROUTES,
  MAX_SEARCH_LENGTH,
  type ConversationResponse,
  type ListConversationsResponse,
  type ListPeopleResponse,
  type QuotaResponse,
  type SearchResponse,
} from '@open-agent/shared';
import { createUIMessageStreamResponse } from 'ai';
import type { BunRequest } from 'bun';

import type { ChatTurns } from '../../application/chat-turns.ts';
import type { Conversations } from '../../application/conversations.ts';
import type { Quotas } from '../../application/quotas.ts';
import type { Sharing, SharingResult } from '../../application/sharing.ts';
import { personOf, type User } from '../../domain/user.ts';
import { error, readJson, type ServerHandle } from './http.ts';
import { toConversationDto, toInvitationDto, toQuotaResponse } from './presenters.ts';

export type ChatHttpDependencies = {
  signedInUser: (request: BunRequest) => Promise<User | null>;
  conversations: Conversations;
  sharing: Sharing;
  chatTurns: ChatTurns;
  quotas: Quotas;
};

const CHAT_STATUS = {
  invalid_request: 400,
  not_found: 404,
  model_unavailable: 503,
  quota_exceeded: 429,
  conversation_busy: 409,
  conversation_changed: 409,
} as const;

function sharingResponse(result: SharingResult): Response {
  if (result.ok) return new Response(null, { status: 204 });
  return error(result.reason, result.reason === 'not_found' ? 404 : 400);
}

export function createChatRoutes({ signedInUser, conversations, sharing, chatTurns, quotas }: ChatHttpDependencies) {
  const withUser = async (request: BunRequest, handle: (user: User) => Promise<Response>) => {
    const user = await signedInUser(request);
    return user ? handle(user) : error('not_signed_in', 401);
  };

  return {
    [API_ROUTES.conversations]: {
      GET: (request: BunRequest) =>
        withUser(request, async (user) => {
          const list = await conversations.list(user);
          return Response.json({
            conversations: list.conversations.map(toConversationDto),
            invitations: list.invitations.map(toInvitationDto),
          } satisfies ListConversationsResponse);
        }),
    },

    [API_ROUTES.conversation]: {
      GET: (request: BunRequest<typeof API_ROUTES.conversation>) =>
        withUser(request, async (user) => {
          const opened = await conversations.open(user, request.params.conversationId);
          if (!opened) return error('not_found', 404);
          return Response.json({
            conversation: toConversationDto(opened.view),
            messages: opened.messages,
            answering: opened.answering && personOf(opened.answering),
          } satisfies ConversationResponse);
        }),
      PATCH: (request: BunRequest<typeof API_ROUTES.conversation>) =>
        withUser(request, async (user) => {
          const body = await readJson(request);
          if (!body) return error('invalid_request', 400);
          const result = await conversations.update(user, request.params.conversationId, body);
          if (!result.ok) return error(result.reason, result.reason === 'not_found' ? 404 : 400);
          return Response.json(toConversationDto(result.view));
        }),
      DELETE: (request: BunRequest<typeof API_ROUTES.conversation>) =>
        withUser(request, async (user) =>
          (await conversations.delete(user, request.params.conversationId))
            ? new Response(null, { status: 204 })
            : error('not_found', 404),
        ),
    },

    [API_ROUTES.conversationMembers]: {
      POST: (request: BunRequest<typeof API_ROUTES.conversationMembers>) =>
        withUser(request, async (user) => {
          const body = await readJson(request);
          if (!body) return error('invalid_request', 400);
          return sharingResponse(await sharing.invite(user, request.params.conversationId, body.userIds));
        }),
    },

    [API_ROUTES.conversationMember]: {
      DELETE: (request: BunRequest<typeof API_ROUTES.conversationMember>) =>
        withUser(request, async (user) => {
          const userId = Number(request.params.userId);
          if (!Number.isInteger(userId)) return error('invalid_request', 400);
          return sharingResponse(await sharing.remove(user, request.params.conversationId, userId));
        }),
    },

    [API_ROUTES.conversationJoin]: {
      POST: (request: BunRequest<typeof API_ROUTES.conversationJoin>) =>
        withUser(request, async (user) => sharingResponse(await sharing.join(user, request.params.conversationId))),
    },

    [API_ROUTES.people]: {
      GET: (request: BunRequest) =>
        withUser(request, async (user) =>
          Response.json({ people: (await sharing.people(user)).map(personOf) } satisfies ListPeopleResponse),
        ),
    },

    [API_ROUTES.search]: {
      GET: (request: BunRequest) =>
        withUser(request, async (user) => {
          const text = new URL(request.url).searchParams.get('q') ?? '';
          if (text.length > MAX_SEARCH_LENGTH) return error('invalid_request', 400);
          const hits = await conversations.search(user, text);
          return Response.json({
            results: hits.map((hit) => ({ conversation: toConversationDto(hit.view), snippet: hit.snippet })),
          } satisfies SearchResponse);
        }),
    },

    [API_ROUTES.chat]: {
      POST: (request: BunRequest, server: ServerHandle) =>
        withUser(request, async (user) => {
          const body = await readJson(request);
          // A thinking model can be silent for longer than Bun's 10 s idle timeout.
          server.timeout(request, 0);
          const result = await chatTurns.start(user, body?.id, body?.messages, body?.ephemeral);
          if (!result.ok) return error(result.reason, CHAT_STATUS[result.reason]);
          // The browser may leave at any time: the answer goes on, and `chatStream` gives it back.
          return createUIMessageStreamResponse({ stream: result.stream });
        }),
    },

    [API_ROUTES.chatStream]: {
      GET: (request: BunRequest<typeof API_ROUTES.chatStream>, server: ServerHandle) =>
        withUser(request, async (user) => {
          server.timeout(request, 0);
          const result = await chatTurns.follow(user, request.params.conversationId);
          if (!result.ok) return error('not_found', 404);
          // 204: nothing being written; the AI SDK then keeps the saved conversation.
          return result.stream
            ? createUIMessageStreamResponse({ stream: result.stream })
            : new Response(null, { status: 204 });
        }),
      DELETE: (request: BunRequest<typeof API_ROUTES.chatStream>) =>
        withUser(request, async (user) =>
          (await chatTurns.stop(user, request.params.conversationId))
            ? new Response(null, { status: 204 })
            : error('not_found', 404),
        ),
    },

    [API_ROUTES.quota]: {
      GET: (request: BunRequest) =>
        withUser(request, async (user) =>
          Response.json(toQuotaResponse(await quotas.of(user)) satisfies QuotaResponse),
        ),
    },
  };
}
