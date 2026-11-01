import { MAX_ARTIFACT_LENGTH, type ArtifactKind } from '@open-agent/shared';

import type { ArtifactRepository } from '../domain/artifact-repository.ts';
import { amendsLatest, cleanArtifactTitle, type Artifact, type ArtifactVersion } from '../domain/artifact.ts';
import type { User } from '../domain/user.ts';
import type { Clock } from './ports/clock.ts';

export type SaveResult =
  | { ok: true; artifact: Artifact }
  | { ok: false; reason: 'not_found' | 'invalid_request' | 'artifact_changed' };

/**
 * The canvas: documents of a conversation, written by the model with its tools and edited by the user in the panel.
 * Every change is a version; the model always works on the latest one, the user's edits included.
 */
export class Artifacts {
  readonly #artifacts: ArtifactRepository;
  readonly #clock: Clock;

  constructor(artifacts: ArtifactRepository, clock: Clock) {
    this.#artifacts = artifacts;
    this.#clock = clock;
  }

  /** From the model's `create_document`. Throws when the content is too long: the model is told and can shorten it. */
  async create(
    user: User,
    conversationId: string,
    input: { kind: ArtifactKind; title: string; content: string },
  ): Promise<Artifact> {
    checkLength(input.content);
    return await this.#artifacts.create(
      {
        id: crypto.randomUUID(),
        conversationId,
        userId: user.id,
        kind: input.kind,
        title: cleanArtifactTitle(input.title),
        createdAt: this.#clock.now(),
      },
      input.content,
      'model',
    );
  }

  /** From the model's `update_document`: only a document of this conversation. Throws otherwise, for the model. */
  async rewrite(conversationId: string, id: string, content: string): Promise<Artifact> {
    checkLength(content);
    const artifact = await this.#artifacts.find(id);
    if (artifact?.conversationId !== conversationId) throw new Error(`No document ${id} in this conversation.`);
    const version = await this.#artifacts.addVersion(id, content, 'model', this.#clock.now());
    return { ...artifact, version, updatedAt: this.#clock.now() };
  }

  /** What the model must see at each answer: the latest content of every document of the conversation. */
  async latestOf(conversationId: string): Promise<{ artifact: Artifact; content: string }[]> {
    const artifacts = await this.#artifacts.listOf(conversationId);
    return await Promise.all(
      artifacts.map(async (artifact) => ({
        artifact,
        content: (await this.#artifacts.version(artifact.id, artifact.version))!.content,
      })),
    );
  }

  async list(user: User, conversationId: string): Promise<Artifact[]> {
    const artifacts = await this.#artifacts.listOf(conversationId);
    return artifacts.filter((artifact) => artifact.userId === user.id);
  }

  async open(
    user: User,
    id: string,
  ): Promise<{ artifact: Artifact; content: string; versions: Omit<ArtifactVersion, 'content'>[] } | null> {
    const artifact = await this.#own(user, id);
    if (!artifact) return null;
    const latest = await this.#artifacts.version(id, artifact.version);
    return { artifact, content: latest!.content, versions: await this.#artifacts.versions(id) };
  }

  async version(user: User, id: string, number: number): Promise<ArtifactVersion | null> {
    return (await this.#own(user, id)) ? await this.#artifacts.version(id, number) : null;
  }

  /**
   * The user's edit, or an old version brought back. Refused when the document changed since `baseVersion`: the
   * user would overwrite the model's newer version without seeing it.
   */
  async save(user: User, id: string, content: unknown, baseVersion: unknown): Promise<SaveResult> {
    if (typeof content !== 'string' || content.length > MAX_ARTIFACT_LENGTH || typeof baseVersion !== 'number') {
      return { ok: false, reason: 'invalid_request' };
    }
    const artifact = await this.#own(user, id);
    if (!artifact) return { ok: false, reason: 'not_found' };
    if (baseVersion !== artifact.version) return { ok: false, reason: 'artifact_changed' };

    const now = this.#clock.now();
    const latest = (await this.#artifacts.version(id, artifact.version))!;
    if (latest.content === content) return { ok: true, artifact };
    if (amendsLatest(latest, now)) {
      await this.#artifacts.amendVersion(id, latest.number, content, now);
      return { ok: true, artifact: { ...artifact, updatedAt: now } };
    }
    const version = await this.#artifacts.addVersion(id, content, 'user', now);
    return { ok: true, artifact: { ...artifact, version, updatedAt: now } };
  }

  async #own(user: User, id: string): Promise<Artifact | null> {
    const artifact = await this.#artifacts.find(id);
    return artifact?.userId === user.id ? artifact : null;
  }
}

function checkLength(content: string): void {
  if (content.length > MAX_ARTIFACT_LENGTH) {
    throw new Error(`The document is longer than ${MAX_ARTIFACT_LENGTH} characters: make it shorter.`);
  }
}
