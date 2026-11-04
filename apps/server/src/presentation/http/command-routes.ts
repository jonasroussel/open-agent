import { API_ROUTES, type CommandDto, type ListCommandsResponse } from '@open-agent/shared';
import type { BunRequest } from 'bun';

import type { CommandResult, Commands } from '../../application/commands.ts';
import type { User } from '../../domain/user.ts';
import { error, readJson } from './http.ts';
import { toCommandDto } from './presenters.ts';

export type CommandHttpDependencies = {
  signedInUser: (request: BunRequest) => Promise<User | null>;
  commands: Commands;
};

const STATUS = { invalid_request: 400, not_found: 404, command_name_taken: 409, commands_full: 409 } as const;

function commandResponse(result: CommandResult, status = 200): Response {
  if (!result.ok) return error(result.reason, STATUS[result.reason]);
  return Response.json(toCommandDto(result.command) satisfies CommandDto, { status });
}

export function createCommandRoutes({ signedInUser, commands }: CommandHttpDependencies) {
  const withUser = async (request: BunRequest, handle: (user: User) => Promise<Response>) => {
    const user = await signedInUser(request);
    return user ? handle(user) : error('not_signed_in', 401);
  };

  return {
    [API_ROUTES.commands]: {
      GET: (request: BunRequest) =>
        withUser(request, async (user) =>
          Response.json({ commands: (await commands.list(user)).map(toCommandDto) } satisfies ListCommandsResponse),
        ),
      POST: (request: BunRequest) =>
        withUser(request, async (user) => {
          const body = await readJson(request);
          return commandResponse(await commands.add(user, body?.name, body?.prompt), 201);
        }),
    },

    [API_ROUTES.commandOrder]: {
      PUT: (request: BunRequest) =>
        withUser(request, async (user) => {
          const body = await readJson(request);
          return (await commands.reorder(user, body?.ids))
            ? new Response(null, { status: 204 })
            : error('invalid_request', 400);
        }),
    },

    [API_ROUTES.command]: {
      PATCH: (request: BunRequest<typeof API_ROUTES.command>) =>
        withUser(request, async (user) => {
          const body = await readJson(request);
          return commandResponse(await commands.update(user, request.params.commandId, body?.name, body?.prompt));
        }),
      DELETE: (request: BunRequest<typeof API_ROUTES.command>) =>
        withUser(request, async (user) =>
          (await commands.delete(user, request.params.commandId))
            ? new Response(null, { status: 204 })
            : error('not_found', 404),
        ),
    },
  };
}
