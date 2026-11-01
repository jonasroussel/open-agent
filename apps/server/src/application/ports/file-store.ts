/** The bytes of the library: each file is a folder holding its original and the pictures read out of it. */
export interface FileStore {
  save(userId: number, fileId: string, name: string, bytes: Uint8Array): Promise<void>;
  /** `null` when missing. */
  read(userId: number, fileId: string, name: string): Promise<Uint8Array | null>;
  /** The whole folder; nothing happens when it is already gone. */
  remove(userId: number, fileId: string): Promise<void>;
}
