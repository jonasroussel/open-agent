import type { ArtifactAuthor, ArtifactKind } from '@open-agent/shared';
import type { Knex } from 'knex';

import type { ArtifactRepository, NewArtifact } from '../../domain/artifact-repository.ts';
import type { Artifact, ArtifactVersion } from '../../domain/artifact.ts';

type ArtifactRow = {
  id: string;
  conversation_id: string;
  user_id: number;
  kind: ArtifactKind;
  title: string;
  created_at: string;
  updated_at: string;
  version: number;
};

type VersionRow = {
  artifact_id: string;
  number: number;
  author: ArtifactAuthor;
  created_at: string;
  restored_from: number | null;
};

const VERSION_COLUMNS = ['artifact_id', 'number', 'author', 'created_at', 'restored_from'] as const;

export class SqliteArtifactRepository implements ArtifactRepository {
  readonly #database: Knex;

  constructor(database: Knex) {
    this.#database = database;
  }

  async create(artifact: NewArtifact, content: string, author: ArtifactAuthor): Promise<Artifact> {
    const at = artifact.createdAt.toISOString();
    await this.#database.transaction(async (trx) => {
      await trx('artifacts').insert({
        id: artifact.id,
        conversation_id: artifact.conversationId,
        user_id: artifact.userId,
        kind: artifact.kind,
        title: artifact.title,
        created_at: at,
        updated_at: at,
      });
      await trx('artifact_versions').insert({ artifact_id: artifact.id, number: 1, content, author, created_at: at });
    });
    return { ...artifact, version: 1, updatedAt: artifact.createdAt };
  }

  async find(id: string): Promise<Artifact | null> {
    const row: ArtifactRow | undefined = await this.#withVersion().where('artifacts.id', id).first();
    return row ? toArtifact(row) : null;
  }

  async listOf(conversationId: string): Promise<Artifact[]> {
    const rows: ArtifactRow[] = await this.#withVersion()
      .where('artifacts.conversation_id', conversationId)
      .orderBy('artifacts.created_at');
    return rows.map(toArtifact);
  }

  async versions(artifactId: string): Promise<Omit<ArtifactVersion, 'content'>[]> {
    const rows: VersionRow[] = await this.#database('artifact_versions')
      .where({ artifact_id: artifactId })
      .select(VERSION_COLUMNS)
      .orderBy('number', 'desc');
    return rows.map(toVersion);
  }

  async version(artifactId: string, number: number): Promise<ArtifactVersion | null> {
    const row: (VersionRow & { content: string }) | undefined = await this.#database('artifact_versions')
      .where({ artifact_id: artifactId, number })
      .first(...VERSION_COLUMNS, 'content');
    return row ? { ...toVersion(row), content: row.content } : null;
  }

  async addVersion(
    artifactId: string,
    content: string,
    author: ArtifactAuthor,
    now: Date,
    restoredFrom: number | null = null,
  ): Promise<number> {
    return await this.#database.transaction(async (trx) => {
      const last = await trx('artifact_versions').where({ artifact_id: artifactId }).max({ number: 'number' }).first();
      const number = Number(last?.number ?? 0) + 1;
      const at = now.toISOString();
      await trx('artifact_versions').insert({
        artifact_id: artifactId,
        number,
        content,
        author,
        created_at: at,
        restored_from: restoredFrom,
      });
      await trx('artifacts').where({ id: artifactId }).update({ updated_at: at });
      return number;
    });
  }

  async amendVersion(artifactId: string, number: number, content: string, now: Date): Promise<void> {
    await this.#database.transaction(async (trx) => {
      await trx('artifact_versions').where({ artifact_id: artifactId, number }).update({ content });
      await trx('artifacts').where({ id: artifactId }).update({ updated_at: now.toISOString() });
    });
  }

  /** Artifacts with the number of their latest version. */
  #withVersion() {
    return this.#database('artifacts')
      .join('artifact_versions', 'artifact_versions.artifact_id', 'artifacts.id')
      .groupBy('artifacts.id')
      .select('artifacts.*', this.#database.raw('max(artifact_versions.number) as version'));
  }
}

function toArtifact(row: ArtifactRow): Artifact {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    userId: row.user_id,
    kind: row.kind,
    title: row.title,
    version: row.version,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function toVersion(row: VersionRow): Omit<ArtifactVersion, 'content'> {
  return {
    artifactId: row.artifact_id,
    number: row.number,
    author: row.author,
    createdAt: new Date(row.created_at),
    restoredFrom: row.restored_from,
  };
}
