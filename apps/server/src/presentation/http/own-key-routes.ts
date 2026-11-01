import { API_ROUTES, type OwnKeyResponse } from '@open-agent/shared';
import type { BunRequest } from 'bun';

import type { OwnKeys, OwnKeyView } from '../../application/own-keys.ts';
import type { User } from '../../domain/user.ts';
import { error, readJson } from './http.ts';

export type OwnKeyHttpDependencies = {
  signedInUser: (request: BunRequest) => Promise<User | null>;
  ownKeys: OwnKeys;
};

const STATUS = { invalid_request: 400, invalid_key: 400, key_check_failed: 502 } as const;

function toOwnKeyResponse(key: OwnKeyView): OwnKeyResponse {
  return { key: key && { hint: key.hint, addedAt: key.addedAt.toISOString() } };
}

export function createOwnKeyRoutes({ signedInUser, ownKeys }: OwnKeyHttpDependencies) {
  const withUser = async (request: BunRequest, handle: (user: User) => Promise<Response>) => {
    const user = await signedInUser(request);
    return user ? handle(user) : error('not_signed_in', 401);
  };

  return {
    [API_ROUTES.ownKey]: {
      GET: (request: BunRequest) =>
        withUser(request, async (user) => Response.json(toOwnKeyResponse(ownKeys.view(user)))),
      PUT: (request: BunRequest) =>
        withUser(request, async (user) => {
          const result = await ownKeys.set(user, (await readJson(request))?.key);
          if (!result.ok) return error(result.reason, STATUS[result.reason]);
          return Response.json(toOwnKeyResponse(result.key));
        }),
      DELETE: (request: BunRequest) =>
        withUser(request, async (user) => {
          await ownKeys.remove(user);
          return new Response(null, { status: 204 });
        }),
    },
  };
}
