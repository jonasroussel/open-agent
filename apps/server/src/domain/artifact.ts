import type { ArtifactAuthor, ArtifactKind } from '@open-agent/shared';

/** A canvas document of a conversation, written by the model and the user together, one version after another. */
export type Artifact = {
  /** A UUID: the model names it in `update_document`. */
  id: string;
  conversationId: string;
  userId: number;
  kind: ArtifactKind;
  title: string;
  /** The latest version's number. */
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

export type ArtifactVersion = {
  artifactId: string;
  number: number;
  content: string;
  author: ArtifactAuthor;
  /** Who wrote a user version; `null` for the model's, and for the users' versions saved before it was recorded. */
  userId: number | null;
  createdAt: Date;
  /** The older version the user brought back as this one; `null` for any other version. */
  restoredFrom: number | null;
};

/**
 * The editor saves while the user types. Saves within this time after the user's own last version change that
 * version, so the list keeps one version per sitting, not one per pause in typing. Another member's version is never
 * changed: their save adds one, so the first writer's next save meets a newer version instead of overwriting it.
 */
export const USER_SITTING_MS = 10 * 60 * 1000;

export function amendsLatest(
  latest: Pick<ArtifactVersion, 'userId' | 'createdAt'>,
  userId: number,
  now: Date,
): boolean {
  return latest.userId === userId && now.getTime() - latest.createdAt.getTime() < USER_SITTING_MS;
}

/** A title the model gave: one line, no Markdown heading marks, at most a sidebar's width. */
export function cleanArtifactTitle(raw: string): string {
  const title = raw
    .split('\n')[0]!
    .replace(/^#+\s*/, '')
    .trim()
    .slice(0, 120);
  return title || 'Document';
}
