import { API_ROUTES, isLocale, type HealthResponse, type SessionResponse } from '@open-agent/shared';
import type { BunRequest } from 'bun';

import type { Artifacts } from '../../application/artifacts.ts';
import type { Authentication, SignInResult } from '../../application/authentication.ts';
import type { ChatTurns } from '../../application/chat-turns.ts';
import type { Conversations } from '../../application/conversations.ts';
import type { Library } from '../../application/library.ts';
import type { Memory } from '../../application/memory.ts';
import type { Quotas } from '../../application/quotas.ts';
import type { UserAccess } from '../../application/user-access.ts';
import { createAdminRoutes } from './admin-routes.ts';
import { createArtifactRoutes } from './artifact-routes.ts';
import { createChatRoutes } from './chat-routes.ts';
import { createFileRoutes } from './file-routes.ts';
import { clientAddress, error, isHttps, readJson, type ServerHandle } from './http.ts';
import { createMemoryRoutes } from './memory-routes.ts';
import { toSignedInUser } from './presenters.ts';

const SESSION_COOKIE = 'session';

export type HttpDependencies = {
  version: string;
  authentication: Authentication;
  userAccess: UserAccess;
  conversations: Conversations;
  memory: Memory;
  chatTurns: ChatTurns;
  quotas: Quotas;
  library: Library;
  artifacts: Artifacts;
};

/** Answers a sign-in: the session cookie and the user, or why it failed. */
function openSession(request: BunRequest, result: SignInResult): Response {
  if (!result.ok) return error(result.reason, result.reason === 'too_many_attempts' ? 429 : 401);
  request.cookies.set(SESSION_COOKIE, result.token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isHttps(request),
    path: '/',
    expires: result.expiresAt,
  });
  return Response.json({ user: toSignedInUser(result.user) } satisfies SessionResponse);
}

export function createRoutes({
  version,
  authentication,
  userAccess,
  conversations,
  memory,
  chatTurns,
  quotas,
  library,
  artifacts,
}: HttpDependencies) {
  const signedInUser = (request: BunRequest) =>
    authentication.signedInUser(request.cookies.get(SESSION_COOKIE) ?? null);

  return {
    [API_ROUTES.health]: {
      GET: () => Response.json({ status: 'ok', version } satisfies HealthResponse),
    },

    [API_ROUTES.session]: {
      GET: async (request: BunRequest) => {
        const user = await signedInUser(request);
        return user
          ? Response.json({ user: toSignedInUser(user) } satisfies SessionResponse)
          : error('not_signed_in', 401);
      },
      DELETE: async (request: BunRequest) => {
        await authentication.signOut(request.cookies.get(SESSION_COOKIE) ?? null);
        request.cookies.delete({ name: SESSION_COOKIE, path: '/' });
        return new Response(null, { status: 204 });
      },
    },

    [API_ROUTES.signInRequests]: {
      POST: async (request: BunRequest, server: ServerHandle) => {
        const body = await readJson(request);
        if (typeof body?.email !== 'string' || !isLocale(body.locale)) return error('invalid_request', 400);
        const result = await authentication.requestSignIn(body.email, body.locale, clientAddress(request, server));
        if (result.ok) return new Response(null, { status: 204 });
        const status = { invalid_request: 400, too_many_attempts: 429, email_failed: 502 }[result.reason];
        return error(result.reason, status);
      },
    },

    [API_ROUTES.signInWithToken]: {
      POST: async (request: BunRequest) => {
        const body = await readJson(request);
        if (typeof body?.token !== 'string') return error('invalid_request', 400);
        return openSession(request, await authentication.signInWithToken(body.token));
      },
    },

    [API_ROUTES.signInWithCode]: {
      POST: async (request: BunRequest, server: ServerHandle) => {
        const body = await readJson(request);
        if (typeof body?.email !== 'string' || typeof body.code !== 'string') return error('invalid_request', 400);
        const result = await authentication.signInWithCode(body.email, body.code, clientAddress(request, server));
        return openSession(request, result);
      },
    },

    ...createAdminRoutes({ signedInUser, userAccess, quotas }),
    ...createChatRoutes({ signedInUser, conversations, chatTurns, quotas }),
    ...createMemoryRoutes({ signedInUser, memory }),
    ...createFileRoutes({ signedInUser, library }),
    ...createArtifactRoutes({ signedInUser, artifacts }),
  };
}
