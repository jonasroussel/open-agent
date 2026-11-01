import type { FileKind } from '@open-agent/shared';
import type { Knex } from 'knex';

import type { FilePiece, LibraryFile } from '../../domain/library-file.ts';
import type { LibraryRepository } from '../../domain/library-repository.ts';

type FileRow = {
  id: string;
  user_id: number;
  name: string;
  kind: FileKind;
  media_type: string;
  size: number;
  created_at: string;
};

const COLUMNS = ['id', 'user_id', 'name', 'kind', 'media_type', 'size', 'created_at'] as const;

export class SqliteLibraryRepository implements LibraryRepository {
  readonly #database: Knex;

  constructor(database: Knex) {
    this.#database = database;
  }

  async create(file: LibraryFile): Promise<void> {
    await this.#database('library_files').insert({
      id: file.id,
      user_id: file.userId,
      name: file.name,
      kind: file.kind,
      media_type: file.mediaType,
      size: file.size,
      content: JSON.stringify(file.content),
      created_at: file.createdAt.toISOString(),
    });
  }

  async listOf(userId: number): Promise<Omit<LibraryFile, 'content'>[]> {
    const rows: FileRow[] = await this.#database('library_files')
      .where({ user_id: userId })
      .select(COLUMNS)
      .orderBy('created_at', 'desc');
    return rows.map(toFile);
  }

  async find(userId: number, id: string): Promise<LibraryFile | null> {
    const row: (FileRow & { content: string }) | undefined = await this.#database('library_files')
      .where({ id, user_id: userId })
      .first([...COLUMNS, 'content']);
    return row ? { ...toFile(row), content: JSON.parse(row.content) as FilePiece[] } : null;
  }

  async delete(id: string): Promise<void> {
    await this.#database('library_files').where({ id }).delete();
  }
}

function toFile(row: FileRow): Omit<LibraryFile, 'content'> {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    kind: row.kind,
    mediaType: row.media_type,
    size: row.size,
    createdAt: new Date(row.created_at),
  };
}
