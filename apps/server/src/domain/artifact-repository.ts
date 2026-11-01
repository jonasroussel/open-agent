import type { ArtifactAuthor } from '@open-agent/shared';

import type { Artifact, ArtifactVersion } from './artifact.ts';

export type NewArtifact = Omit<Artifact, 'version' | 'updatedAt'>;

export interface ArtifactRepository {
  /** With its first version. */
  create(artifact: NewArtifact, content: string, author: ArtifactAuthor): Promise<Artifact>;
  find(id: string): Promise<Artifact | null>;
  /** Oldest first. */
  listOf(conversationId: string): Promise<Artifact[]>;
  /** Newest first, without their content. */
  versions(artifactId: string): Promise<Omit<ArtifactVersion, 'content'>[]>;
  version(artifactId: string, number: number): Promise<ArtifactVersion | null>;
  /** Returns the new version's number. */
  addVersion(artifactId: string, content: string, author: ArtifactAuthor, now: Date): Promise<number>;
  /** Rewrites the content of a version; its number and author stay. */
  amendVersion(artifactId: string, number: number, content: string, now: Date): Promise<void>;
}
