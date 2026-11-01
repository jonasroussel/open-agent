import { fileKindOf, MAX_FILE_BYTES, mediaTypeOf, type FileKind } from '@open-agent/shared';

import type { ChatMessage } from '../domain/conversation.ts';
import {
  cleanFileName,
  estimatedTokens,
  fileIdOf,
  MAX_FILE_TOKENS,
  ORIGINAL,
  pageImageName,
  previewOf,
  type FilePiece,
  type LibraryFile,
} from '../domain/library-file.ts';
import type { LibraryRepository } from '../domain/library-repository.ts';
import type { User } from '../domain/user.ts';
import type { Clock } from './ports/clock.ts';
import { UnreadableDocument, type DocumentReader } from './ports/document-reader.ts';
import type { FileStore } from './ports/file-store.ts';

export type Upload = { name: string; mediaType: string; bytes: Uint8Array };

export type UploadResult =
  | { ok: true; file: LibraryFile }
  | { ok: false; reason: 'file_too_large' | 'file_type_unsupported' | 'file_unreadable' | 'file_too_long' };

type Picture = { name: string; bytes: Uint8Array };

const EXTENSIONS: Record<string, string> = { 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' };

/**
 * Each user's files. A file is read once, at upload, into what the model needs to know all of it: the whole text, and
 * a picture of every PDF page and of every image in a Word file. Every answer then gets the whole file again, so the
 * user can ask about any detail of it, even many messages later.
 */
export class Library {
  readonly #files: LibraryRepository;
  readonly #store: FileStore;
  readonly #reader: DocumentReader;
  readonly #clock: Clock;

  constructor(files: LibraryRepository, store: FileStore, reader: DocumentReader, clock: Clock) {
    this.#files = files;
    this.#store = store;
    this.#reader = reader;
    this.#clock = clock;
  }

  async upload(user: User, upload: Upload): Promise<UploadResult> {
    if (upload.bytes.length > MAX_FILE_BYTES) return { ok: false, reason: 'file_too_large' };
    const kind = fileKindOf(upload.name, upload.mediaType);
    if (!kind) return { ok: false, reason: 'file_type_unsupported' };
    const mediaType = mediaTypeOf(kind, upload.name, upload.mediaType);

    const pictures: Picture[] = [];
    let content: FilePiece[];
    try {
      content = await this.#read(kind, mediaType, upload.bytes, pictures);
    } catch (error) {
      if (error instanceof UnreadableDocument) return { ok: false, reason: 'file_unreadable' };
      throw error;
    }
    if (content.length === 0) return { ok: false, reason: 'file_unreadable' };
    if (estimatedTokens(content) > MAX_FILE_TOKENS) return { ok: false, reason: 'file_too_long' };

    const file: LibraryFile = {
      id: crypto.randomUUID(),
      userId: user.id,
      name: cleanFileName(upload.name),
      kind,
      mediaType,
      size: upload.bytes.length,
      content,
      createdAt: this.#clock.now(),
    };
    await this.#store.save(user.id, file.id, ORIGINAL, upload.bytes);
    for (const picture of pictures) await this.#store.save(user.id, file.id, picture.name, picture.bytes);
    await this.#files.create(file);
    return { ok: true, file };
  }

  list(user: User): Promise<Omit<LibraryFile, 'content'>[]> {
    return this.#files.listOf(user.id);
  }

  /** The original, for its owner only. */
  async open(user: User, id: string): Promise<{ file: LibraryFile; bytes: Uint8Array } | null> {
    const file = await this.#files.find(user.id, id);
    const bytes = file && (await this.#store.read(user.id, file.id, ORIGINAL));
    return file && bytes ? { file, bytes } : null;
  }

  /** The picture of `previewOf`, for its owner only; `null` for kinds without one. */
  async preview(user: User, id: string): Promise<{ bytes: Uint8Array; mediaType: string } | null> {
    const file = await this.#files.find(user.id, id);
    const preview = file && previewOf(file);
    const bytes = preview && (await this.#store.read(user.id, id, preview.name));
    return preview && bytes ? { bytes, mediaType: preview.mediaType } : null;
  }

  /** The conversations keep their messages; the model is then told the file was deleted. */
  async delete(user: User, id: string): Promise<boolean> {
    const file = await this.#files.find(user.id, id);
    if (!file) return false;
    await this.#files.delete(file.id);
    await this.#store.remove(user.id, file.id);
    return true;
  }

  /** Every `file` part becomes the file's whole content, as text and pictures, between `<file>` tags. */
  async expandFiles(user: User, messages: readonly ChatMessage[]): Promise<ChatMessage[]> {
    return await Promise.all(
      messages.map(async (message) => {
        if (!message.parts.some((part) => part.type === 'file')) return message;
        const parts = await Promise.all(
          message.parts.map(async (part) => {
            if (part.type !== 'file') return [part];
            const file = await this.#files.find(user.id, fileIdOf(part.url) ?? '');
            if (!file) {
              const text = `[The file "${part.filename ?? 'file'}" was deleted from the library: its content is no longer available.]`;
              return [{ type: 'text' as const, text }];
            }
            return await this.#modelParts(file);
          }),
        );
        return { ...message, parts: parts.flat() };
      }),
    );
  }

  async #modelParts(file: LibraryFile): Promise<ChatMessage['parts']> {
    const pieces = await Promise.all(
      file.content.map(async (piece): Promise<ChatMessage['parts'][number]> => {
        if (piece.type === 'text') return { type: 'text', text: piece.text };
        const bytes = await this.#store.read(file.userId, file.id, piece.name);
        if (!bytes) return { type: 'text', text: '[A picture of this file is missing.]' };
        const url = `data:${piece.mediaType};base64,${Buffer.from(bytes).toString('base64')}`;
        return { type: 'file', mediaType: piece.mediaType, url };
      }),
    );
    return [
      { type: 'text', text: `<file name="${file.name.replaceAll('"', "'")}">` },
      ...pieces,
      { type: 'text', text: '</file>' },
    ];
  }

  async #read(kind: FileKind, mediaType: string, bytes: Uint8Array, pictures: Picture[]): Promise<FilePiece[]> {
    switch (kind) {
      case 'image':
        return [{ type: 'image', name: ORIGINAL, mediaType }];
      case 'text': {
        const text = new TextDecoder().decode(bytes);
        return text.trim() ? [{ type: 'text', text }] : [];
      }
      case 'pdf': {
        const pages = await this.#reader.readPdf(bytes);
        return pages.flatMap((page, index) => {
          const name = pageImageName(index + 1);
          pictures.push({ name, bytes: page.image });
          const text = page.text || '(No text layer: read the picture.)';
          return [
            { type: 'text' as const, text: `Page ${index + 1} of ${pages.length}:\n${text}` },
            { type: 'image' as const, name, mediaType: 'image/jpeg' },
          ];
        });
      }
      case 'word': {
        const pieces = await this.#reader.readWord(bytes);
        return pieces.map((piece) => {
          if (piece.type === 'text') return piece;
          const name = `image-${pictures.length + 1}.${EXTENSIONS[piece.mediaType] ?? 'jpg'}`;
          pictures.push({ name, bytes: piece.bytes });
          return { type: 'image' as const, name, mediaType: piece.mediaType };
        });
      }
    }
  }
}
