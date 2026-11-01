import { API_ROUTES, type ListMemoryRulesResponse, type MemoryRuleDto } from '@open-agent/shared';
import type { BunRequest } from 'bun';

import type { Memory, RuleResult } from '../../application/memory.ts';
import type { User } from '../../domain/user.ts';
import { error, readJson } from './http.ts';
import { toMemoryRuleDto } from './presenters.ts';

export type MemoryHttpDependencies = {
  signedInUser: (request: BunRequest) => Promise<User | null>;
  memory: Memory;
};

const RULE_STATUS = { invalid_request: 400, not_found: 404, memory_full: 409 } as const;

function ruleResponse(result: RuleResult, status = 200): Response {
  if (!result.ok) return error(result.reason, RULE_STATUS[result.reason]);
  return Response.json(toMemoryRuleDto(result.rule) satisfies MemoryRuleDto, { status });
}

export function createMemoryRoutes({ signedInUser, memory }: MemoryHttpDependencies) {
  const withUser = async (request: BunRequest, handle: (user: User) => Promise<Response>) => {
    const user = await signedInUser(request);
    return user ? handle(user) : error('not_signed_in', 401);
  };

  return {
    [API_ROUTES.memoryRules]: {
      GET: (request: BunRequest) =>
        withUser(request, async (user) => {
          const rules = await memory.rules(user);
          return Response.json({ rules: rules.map(toMemoryRuleDto) } satisfies ListMemoryRulesResponse);
        }),
      POST: (request: BunRequest) =>
        withUser(request, async (user) => {
          const body = await readJson(request);
          if (typeof body?.text !== 'string') return error('invalid_request', 400);
          return ruleResponse(await memory.add(user, body.text), 201);
        }),
    },

    [API_ROUTES.memoryRule]: {
      PATCH: (request: BunRequest<typeof API_ROUTES.memoryRule>) =>
        withUser(request, async (user) => {
          const body = await readJson(request);
          if (typeof body?.text !== 'string') return error('invalid_request', 400);
          return ruleResponse(await memory.rewrite(user, Number(request.params.ruleId), body.text));
        }),
      DELETE: (request: BunRequest<typeof API_ROUTES.memoryRule>) =>
        withUser(request, async (user) =>
          (await memory.forget(user, Number(request.params.ruleId)))
            ? new Response(null, { status: 204 })
            : error('not_found', 404),
        ),
    },

    [API_ROUTES.memoryChangeUndo]: {
      POST: (request: BunRequest<typeof API_ROUTES.memoryChangeUndo>) =>
        withUser(request, async (user) => {
          const result = await memory.undo(user, Number(request.params.changeId));
          if (result.ok) return new Response(null, { status: 204 });
          return error(result.reason, result.reason === 'not_found' ? 404 : 409);
        }),
    },
  };
}
