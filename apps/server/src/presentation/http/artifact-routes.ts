import {
  API_ROUTES,
  type ArtifactResponse,
  type ArtifactVersionResponse,
  type ListArtifactsResponse,
  type SaveArtifactResponse,
} from '@open-agent/shared';
import type { BunRequest } from 'bun';

import type { Artifacts } from '../../application/artifacts.ts';
import type { User } from '../../domain/user.ts';
import { error, readJson } from './http.ts';
import { toArtifactDto, toArtifactVersionDto } from './presenters.ts';

export type ArtifactHttpDependencies = {
  signedInUser: (request: BunRequest) => Promise<User | null>;
  artifacts: Artifacts;
};

const SAVE_STATUS = { invalid_request: 400, not_found: 404, artifact_changed: 409 } as const;

export function createArtifactRoutes({ signedInUser, artifacts }: ArtifactHttpDependencies) {
  const withUser = async (request: BunRequest, handle: (user: User) => Promise<Response>) => {
    const user = await signedInUser(request);
    return user ? handle(user) : error('not_signed_in', 401);
  };

  return {
    [API_ROUTES.conversationArtifacts]: {
      GET: (request: BunRequest<typeof API_ROUTES.conversationArtifacts>) =>
        withUser(request, async (user) => {
          const list = await artifacts.list(user, request.params.conversationId);
          return Response.json({ artifacts: list.map(toArtifactDto) } satisfies ListArtifactsResponse);
        }),
    },

    [API_ROUTES.artifact]: {
      GET: (request: BunRequest<typeof API_ROUTES.artifact>) =>
        withUser(request, async (user) => {
          const opened = await artifacts.open(user, request.params.artifactId);
          if (!opened) return error('not_found', 404);
          return Response.json({
            artifact: toArtifactDto(opened.artifact),
            content: opened.content,
            versions: opened.versions.map(toArtifactVersionDto),
          } satisfies ArtifactResponse);
        }),
    },

    [API_ROUTES.artifactVersions]: {
      POST: (request: BunRequest<typeof API_ROUTES.artifactVersions>) =>
        withUser(request, async (user) => {
          const body = await readJson(request);
          const result = await artifacts.save(user, request.params.artifactId, body?.content, body?.baseVersion);
          if (!result.ok) return error(result.reason, SAVE_STATUS[result.reason]);
          return Response.json({ artifact: toArtifactDto(result.artifact) } satisfies SaveArtifactResponse);
        }),
    },

    [API_ROUTES.artifactVersion]: {
      GET: (request: BunRequest<typeof API_ROUTES.artifactVersion>) =>
        withUser(request, async (user) => {
          const version = await artifacts.version(user, request.params.artifactId, Number(request.params.number));
          if (!version) return error('not_found', 404);
          return Response.json({
            ...toArtifactVersionDto(version),
            content: version.content,
          } satisfies ArtifactVersionResponse);
        }),
    },
  };
}
