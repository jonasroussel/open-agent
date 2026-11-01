import type { LibraryFile } from './library-file.ts';

export interface LibraryRepository {
  create(file: LibraryFile): Promise<void>;
  /** Newest first, without their content. */
  listOf(userId: number): Promise<Omit<LibraryFile, 'content'>[]>;
  /** Only the user's own file: anyone else's is `null`, as if it did not exist. */
  find(userId: number, id: string): Promise<LibraryFile | null>;
  delete(id: string): Promise<void>;
}
