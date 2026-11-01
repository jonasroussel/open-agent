import {
  API_ROUTES,
  MAX_SEARCH_LENGTH,
  type ConversationResponse,
  type ListConversationsResponse,
  type QuotaResponse,
  type SearchResponse,
} from '@open-agent/shared';
import { consumeStream, createUIMessageStreamResponse } from 'ai';
import type { BunRequest } from 'bun';

import type { ChatTurns } from '../../application/chat-turns.ts';
import type { Conversations } from '../../application/conversations.ts';
import type { Quotas } from '../../application/quotas.ts';
import type { User } from '../../domain/user.ts';
import { error, readJson, type ServerHandle } from './http.ts';
import { toConversationDto, toQuotaResponse } from './presenters.ts';

export type ChatHttpDependencies = {
  signedInUser: (request: BunRequest) => Promise<User | null>;
  conversations: Conversations;
  chatTurns: ChatTurns;
  quotas: Quotas;
};

const CHAT_STATUS = { invalid_request: 400, not_found: 404, model_unavailable: 503, quota_exceeded: 429 } as const;

export function createChatRoutes({ signedInUser, conversations, chatTurns, quotas }: ChatHttpDependencies) {
  const withUser = async (request: BunRequest, handle: (user: User) => Promise<Response>) => {
    const user = await signedInUser(request);
    return user ? handle(user) : error('not_signed_in', 401);
  };

  return {
    [API_ROUTES.conversations]: {
      GET: (request: BunRequest) =>
        withUser(request, async (user) => {
          const list = await conversations.list(user);
          return Response.json({ conversations: list.map(toConversationDto) } satisfies ListConversationsResponse);
        }),
    },

    [API_ROUTES.conversation]: {
      GET: (request: BunRequest<typeof API_ROUTES.conversation>) =>
        withUser(request, async (user) => {
          const opened = await conversations.open(user, request.params.conversationId);
          if (!opened) return error('not_found', 404);
          return Response.json({
            conversation: toConversationDto(opened.conversation),
            messages: opened.messages,
          } satisfies ConversationResponse);
        }),
      PATCH: (request: BunRequest<typeof API_ROUTES.conversation>) =>
        withUser(request, async (user) => {
          const body = await readJson(request);
          if (!body) return error('invalid_request', 400);
          const result = await conversations.update(user, request.params.conversationId, body);
          if (!result.ok) return error(result.reason, result.reason === 'not_found' ? 404 : 400);
          return Response.json(toConversationDto(result.conversation));
        }),
      DELETE: (request: BunRequest<typeof API_ROUTES.conversation>) =>
        withUser(request, async (user) =>
          (await conversations.delete(user, request.params.conversationId))
            ? new Response(null, { status: 204 })
            : error('not_found', 404),
        ),
    },

    [API_ROUTES.search]: {
      GET: (request: BunRequest) =>
        withUser(request, async (user) => {
          const text = new URL(request.url).searchParams.get('q') ?? '';
          if (text.length > MAX_SEARCH_LENGTH) return error('invalid_request', 400);
          const hits = await conversations.search(user, text);
          return Response.json({
            results: hits.map((hit) => ({ conversation: toConversationDto(hit.conversation), snippet: hit.snippet })),
          } satisfies SearchResponse);
        }),
    },

    [API_ROUTES.chat]: {
      POST: (request: BunRequest, server: ServerHandle) =>
        withUser(request, async (user) => {
          const body = await readJson(request);
          // A thinking model can be silent for longer than Bun's 10 s idle timeout.
          server.timeout(request, 0);
          const result = await chatTurns.start(user, body?.id, body?.messages, request.signal);
          if (!result.ok) return error(result.reason, CHAT_STATUS[result.reason]);
          // Reading a copy to the end lets the history be saved when the user stops or the phone drops the connection.
          return createUIMessageStreamResponse({ stream: result.stream, consumeSseStream: consumeStream });
        }),
    },

    [API_ROUTES.quota]: {
      GET: (request: BunRequest) =>
        withUser(request, async (user) =>
          Response.json(toQuotaResponse(await quotas.of(user)) satisfies QuotaResponse),
        ),
    },
  };
}
