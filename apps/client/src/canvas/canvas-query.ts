import {
  API_ROUTES,
  apiPath,
  type ArtifactKind,
  type ArtifactResponse,
  type ArtifactVersionResponse,
  type ChatMessage,
  type SaveArtifactBody,
  type SaveArtifactResponse,
} from '@open-agent/shared';
import { queryOptions } from '@tanstack/react-query';

import { api, apiOrThrow } from '@/lib/api.ts';

export const artifactQuery = (id: string) =>
  queryOptions({
    queryKey: [API_ROUTES.artifact, id],
    queryFn: () => apiOrThrow<ArtifactResponse>(apiPath(API_ROUTES.artifact, { artifactId: id })),
  });

export const artifactVersionQuery = (id: string, number: number) =>
  queryOptions({
    queryKey: [API_ROUTES.artifactVersion, id, number],
    queryFn: () => apiOrThrow<ArtifactVersionResponse>(apiPath(API_ROUTES.artifactVersion, { artifactId: id, number })),
    // A version never changes, except the user's latest one, which is never shown from here.
    staleTime: Infinity,
  });

export function saveArtifact(id: string, body: SaveArtifactBody) {
  return api<SaveArtifactResponse>(apiPath(API_ROUTES.artifactVersions, { artifactId: id }), { method: 'POST', body });
}

/** A document the model is writing right now: shown in the canvas as it comes, before it is saved. */
export type LiveDocument = {
  /** `null` while a new document is written: the server gives its id at the end. */
  id: string | null;
  kind: ArtifactKind | null;
  title: string | null;
  content: string;
};

/** The document tool call still running in the answer being written, if any. */
export function liveDocumentOf(message: ChatMessage | undefined): LiveDocument | null {
  if (message?.role !== 'assistant') return null;
  const part = message.parts.findLast(
    (candidate) => candidate.type === 'tool-create_document' || candidate.type === 'tool-update_document',
  );
  if (!part || (part.state !== 'input-streaming' && part.state !== 'input-available')) return null;
  const input = part.input as Partial<{ id: string; kind: ArtifactKind; title: string; content: string }> | undefined;
  return {
    id: input?.id ?? null,
    kind: input?.kind ?? null,
    title: input?.title ?? null,
    content: input?.content ?? '',
  };
}
