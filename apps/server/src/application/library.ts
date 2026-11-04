import { fileKindOf, MAX_FILE_BYTES, mediaTypeOf, type FileKind } from '@open-agent/shared';

import type { ConversationRepository } from '../domain/conversation-repository.ts';
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
import type { ChangeFeed } from './ports/change-feed.ts';
import type { Clock } from './ports/clock.ts';
import { DocumentTooLong, UnreadableDocument, type DocumentReader } from './ports/document-reader.ts';
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
  readonly #conversations: ConversationRepository;
  readonly #store: FileStore;
  readonly #reader: DocumentReader;
  readonly #clock: Clock;
  readonly #changes: ChangeFeed;

  constructor(
    files: LibraryRepository,
    conversations: ConversationRepository,
    store: FileStore,
    reader: DocumentReader,
    clock: Clock,
    changes: ChangeFeed,
  ) {
    this.#files = files;
    this.#conversations = conversations;
    this.#store = store;
    this.#reader = reader;
    this.#clock = clock;
    this.#changes = changes;
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
      if (error instanceof DocumentTooLong) return { ok: false, reason: 'file_too_long' };
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
    this.#changes.publish(user.id, { type: 'files' });
    return { ok: true, file };
  }

  list(user: User): Promise<Omit<LibraryFile, 'content'>[]> {
    return this.#files.listOf(user.id);
  }

  /** The original, for its owner and for the other members of a shared conversation it was sent or made in. */
  async open(user: User, id: string): Promise<{ file: LibraryFile; bytes: Uint8Array } | null> {
    const file = await this.#visible(user, id);
    const bytes = file && (await this.#store.read(file.userId, file.id, ORIGINAL));
    return file && bytes ? { file, bytes } : null;
  }

  /** The picture of `previewOf`, for those who may `open` the file; `null` for kinds without one. */
  async preview(user: User, id: string): Promise<{ bytes: Uint8Array; mediaType: string } | null> {
    const file = await this.#visible(user, id);
    const preview = file && previewOf(file);
    const bytes = preview && (await this.#store.read(file.userId, id, preview.name));
    return preview && bytes ? { bytes, mediaType: preview.mediaType } : null;
  }

  /** The conversations keep their messages; the model is then told the file was deleted. */
  async delete(user: User, id: string): Promise<boolean> {
    const file = await this.#files.find(user.id, id);
    if (!file) return false;
    await this.#files.delete(file.id);
    await this.#store.remove(user.id, file.id);
    this.#changes.publish(user.id, { type: 'files' });
    return true;
  }

  /** A file's text, for the model's `read_file`; its pictures stay out, the model is told there are some. */
  async text(user: User, id: string): Promise<{ file: LibraryFile; text: string; hasPictures: boolean } | null> {
    const file = await this.#files.find(user.id, id);
    if (!file) return null;
    const texts = file.content.flatMap((piece) => (piece.type === 'text' ? [piece.text] : []));
    return { file, text: texts.join('\n\n'), hasPictures: texts.length < file.content.length };
  }

  /**
   * Every `file` part becomes the file's whole content, as text and pictures, between `<file>` tags. `owners`: the
   * conversation's participants, whose files it may hold.
   */
  async expandFiles(owners: readonly number[], messages: readonly ChatMessage[]): Promise<ChatMessage[]> {
    return await Promise.all(
      messages.map(async (message) => {
        if (!message.parts.some((part) => part.type === 'file')) return message;
        const parts = await Promise.all(
          message.parts.map(async (part) => {
            if (part.type !== 'file') return [part];
            const found = await this.#files.findById(fileIdOf(part.url) ?? '');
            const file = found && owners.includes(found.userId) ? found : null;
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

  async #visible(user: User, id: string): Promise<LibraryFile | null> {
    const file = await this.#files.findById(id);
    if (!file) return null;
    return file.userId === user.id || (await this.#conversations.sharesFile(user.id, id, file.userId)) ? file : null;
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
      { type: 'text', text: `<file id="${file.id}" name="${file.name.replaceAll('"', "'")}">` },
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
      case 'spreadsheet':
        return [{ type: 'text', text: await this.#reader.readSpreadsheet(bytes) }];
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
