import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

import type { FileStore } from '../../application/ports/file-store.ts';

/** `<root>/<userId>/<fileId>/<name>`. Ids are UUIDs and names come from the app, never from the user. */
export class DiskFileStore implements FileStore {
  readonly #root: string;

  constructor(root: string) {
    this.#root = root;
  }

  async save(userId: number, fileId: string, name: string, bytes: Uint8Array): Promise<void> {
    const folder = this.#folder(userId, fileId);
    await mkdir(folder, { recursive: true });
    await Bun.write(join(folder, name), bytes);
  }

  async read(userId: number, fileId: string, name: string): Promise<Uint8Array | null> {
    const file = Bun.file(join(this.#folder(userId, fileId), name));
    return (await file.exists()) ? await file.bytes() : null;
  }

  async remove(userId: number, fileId: string): Promise<void> {
    await rm(this.#folder(userId, fileId), { recursive: true, force: true });
  }

  #folder(userId: number, fileId: string): string {
    return join(this.#root, String(userId), fileId);
  }
}
