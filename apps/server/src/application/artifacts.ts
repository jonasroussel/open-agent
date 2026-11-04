import { MAX_ARTIFACT_LENGTH, type ArtifactKind } from '@open-agent/shared';

import type { ArtifactRepository } from '../domain/artifact-repository.ts';
import { amendsLatest, cleanArtifactTitle, type Artifact, type ArtifactVersion } from '../domain/artifact.ts';
import type { User } from '../domain/user.ts';
import type { Participants } from './participants.ts';
import type { Clock } from './ports/clock.ts';

export type SaveResult =
  | { ok: true; artifact: Artifact }
  | { ok: false; reason: 'not_found' | 'invalid_request' | 'artifact_changed' };

/**
 * The canvas: documents of a conversation, written by the model with its tools and edited by the user in the panel.
 * Every change is a version; the model always works on the latest one, the user's edits included. Everyone in a shared
 * conversation reads and edits its documents.
 */
export class Artifacts {
  readonly #artifacts: ArtifactRepository;
  readonly #clock: Clock;
  readonly #participants: Participants;

  constructor(artifacts: ArtifactRepository, clock: Clock, participants: Participants) {
    this.#artifacts = artifacts;
    this.#clock = clock;
    this.#participants = participants;
  }

  /** From the model's `create_document`. Throws when the content is too long: the model is told and can shorten it. */
  async create(
    user: User,
    conversationId: string,
    input: { kind: ArtifactKind; title: string; content: string },
  ): Promise<Artifact> {
    checkLength(input.content);
    const artifact = await this.#artifacts.create(
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
    await this.#participants.publish(conversationId, { type: 'artifact', id: artifact.id });
    return artifact;
  }

  /** From the model's `update_document`: only a document of this conversation. Throws otherwise, for the model. */
  async rewrite(conversationId: string, id: string, content: string): Promise<Artifact> {
    checkLength(content);
    const artifact = await this.#artifacts.find(id);
    if (artifact?.conversationId !== conversationId) throw new Error(`No document ${id} in this conversation.`);
    const version = await this.#artifacts.addVersion(id, content, 'model', this.#clock.now());
    await this.#participants.publish(conversationId, { type: 'artifact', id });
    return { ...artifact, version, updatedAt: this.#clock.now() };
  }

  /**
   * What the model must see at each answer: the latest content of every document of the conversation, and which older
   * version the user brought back, if the latest is one.
   */
  async latestOf(
    conversationId: string,
  ): Promise<{ artifact: Artifact; content: string; restoredFrom: number | null }[]> {
    const artifacts = await this.#artifacts.listOf(conversationId);
    return await Promise.all(
      artifacts.map(async (artifact) => {
        const latest = (await this.#artifacts.version(artifact.id, artifact.version))!;
        return { artifact, content: latest.content, restoredFrom: latest.restoredFrom };
      }),
    );
  }

  async list(user: User, conversationId: string): Promise<Artifact[]> {
    return (await this.#participants.access(user, conversationId)) ? await this.#artifacts.listOf(conversationId) : [];
  }

  async open(
    user: User,
    id: string,
  ): Promise<{ artifact: Artifact; content: string; versions: Omit<ArtifactVersion, 'content'>[] } | null> {
    const artifact = await this.#reachable(user, id);
    if (!artifact) return null;
    const latest = await this.#artifacts.version(id, artifact.version);
    return { artifact, content: latest!.content, versions: await this.#artifacts.versions(id) };
  }

  async version(user: User, id: string, number: number): Promise<ArtifactVersion | null> {
    return (await this.#reachable(user, id)) ? await this.#artifacts.version(id, number) : null;
  }

  /**
   * The user's edit, or an old version brought back (`restoredFrom`). Refused when the document changed since
   * `baseVersion`: the user would overwrite the model's newer version without seeing it. A restore is always a new
   * version, so the model can be told what was undone.
   */
  async save(
    user: User,
    id: string,
    content: unknown,
    baseVersion: unknown,
    restoredFrom: unknown = null,
  ): Promise<SaveResult> {
    if (typeof content !== 'string' || content.length > MAX_ARTIFACT_LENGTH || typeof baseVersion !== 'number') {
      return { ok: false, reason: 'invalid_request' };
    }
    const artifact = await this.#reachable(user, id);
    if (!artifact) return { ok: false, reason: 'not_found' };
    if (baseVersion !== artifact.version) return { ok: false, reason: 'artifact_changed' };
    if (restoredFrom !== null && typeof restoredFrom !== 'number') return { ok: false, reason: 'invalid_request' };
    const restored = restoredFrom === null ? null : await this.#artifacts.version(id, restoredFrom);
    if (restoredFrom !== null && (!restored || restored.number >= artifact.version || restored.content !== content)) {
      return { ok: false, reason: 'invalid_request' };
    }

    const now = this.#clock.now();
    const latest = (await this.#artifacts.version(id, artifact.version))!;
    if (latest.content === content) return { ok: true, artifact };
    if (!restored && amendsLatest(latest, now)) {
      await this.#artifacts.amendVersion(id, latest.number, content, now);
      await this.#participants.publish(artifact.conversationId, { type: 'artifact', id });
      return { ok: true, artifact: { ...artifact, updatedAt: now } };
    }
    const version = await this.#artifacts.addVersion(id, content, 'user', now, restored?.number ?? null);
    await this.#participants.publish(artifact.conversationId, { type: 'artifact', id });
    return { ok: true, artifact: { ...artifact, version, updatedAt: now } };
  }

  async #reachable(user: User, id: string): Promise<Artifact | null> {
    const artifact = await this.#artifacts.find(id);
    return artifact && (await this.#participants.access(user, artifact.conversationId)) ? artifact : null;
  }
}

function checkLength(content: string): void {
  if (content.length > MAX_ARTIFACT_LENGTH) {
    throw new Error(`The document is longer than ${MAX_ARTIFACT_LENGTH} characters: make it shorter.`);
  }
}
