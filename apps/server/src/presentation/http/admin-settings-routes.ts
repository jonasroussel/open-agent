import {
  API_ROUTES,
  type AdminSettingsResponse,
  type ListMemoryRulesResponse,
  type ListModelsResponse,
  type ModelInfoDto,
} from '@open-agent/shared';
import type { BunRequest } from 'bun';

import type { Memory } from '../../application/memory.ts';
import type { ModelDirectory } from '../../application/ports/model-catalog.ts';
import type { Settings } from '../../application/settings.ts';
import type { UserAccess } from '../../application/user-access.ts';
import type { User } from '../../domain/user.ts';
import { adminOnly } from './admin-routes.ts';
import { error, readJson } from './http.ts';
import { toMemoryRuleDto } from './presenters.ts';

export type AdminSettingsHttpDependencies = {
  signedInUser: (request: BunRequest) => Promise<User | null>;
  settings: Settings;
  modelDirectory: ModelDirectory;
  userAccess: UserAccess;
  memory: Memory;
};

const MODEL_STATUS = { invalid_request: 400, model_not_found: 404, model_unsuitable: 422 } as const;

/** The admin page's settings: the model of each role, the prompts, and a person's memory. */
export function createAdminSettingsRoutes({
  signedInUser,
  settings,
  modelDirectory,
  userAccess,
  memory,
}: AdminSettingsHttpDependencies) {
  const withAdmin = adminOnly(signedInUser);
  const person = async (request: BunRequest<'/:userId'>) => {
    const userId = Number(request.params.userId);
    return Number.isInteger(userId) ? await userAccess.find(userId) : null;
  };

  return {
    [API_ROUTES.adminSettings]: {
      GET: (request: BunRequest) =>
        withAdmin(request, async () => Response.json(settings.view() satisfies AdminSettingsResponse)),
    },

    [API_ROUTES.adminModels]: {
      GET: (request: BunRequest) =>
        withAdmin(request, async () => {
          const models = await modelDirectory.list().catch(() => null);
          if (!models) return error('model_unavailable', 503);
          return Response.json({ models: models satisfies ModelInfoDto[] } satisfies ListModelsResponse);
        }),
    },

    [API_ROUTES.adminModel]: {
      PUT: (request: BunRequest<typeof API_ROUTES.adminModel>) =>
        withAdmin(request, async () => {
          const body = await readJson(request);
          const result = await settings.setModel(request.params.role, body?.modelId).catch(() => null);
          if (!result) return error('model_unavailable', 503);
          if (!result.ok) return error(result.reason, MODEL_STATUS[result.reason]);
          return Response.json(result.model satisfies ModelInfoDto);
        }),
    },

    [API_ROUTES.adminPrompt]: {
      PUT: (request: BunRequest<typeof API_ROUTES.adminPrompt>) =>
        withAdmin(request, async () => {
          const body = await readJson(request);
          if (!body || !(await settings.setPrompt(request.params.name, body.text)))
            return error('invalid_request', 400);
          return new Response(null, { status: 204 });
        }),
    },

    [API_ROUTES.adminUserMemory]: {
      GET: (request: BunRequest<typeof API_ROUTES.adminUserMemory>) =>
        withAdmin(request, async () => {
          const user = await person(request);
          if (!user) return error('not_found', 404);
          const rules = await memory.rules(user);
          return Response.json({ rules: rules.map(toMemoryRuleDto) } satisfies ListMemoryRulesResponse);
        }),
    },

    [API_ROUTES.adminUserMemoryRule]: {
      DELETE: (request: BunRequest<typeof API_ROUTES.adminUserMemoryRule>) =>
        withAdmin(request, async () => {
          const user = await person(request);
          const forgotten = user && (await memory.forget(user, Number(request.params.ruleId), 'admin'));
          return forgotten ? new Response(null, { status: 204 }) : error('not_found', 404);
        }),
    },
  };
}
