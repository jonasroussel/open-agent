import { fileKindOf, MAX_FILE_BYTES, mediaTypeOf, type FileKind, type ModelCapability } from '@open-agent/shared';

import type { ConversationRepository } from '../domain/conversation-repository.ts';
import type { ChatMessage } from '../domain/conversation.ts';
import {
  cleanFileName,
  CONVERTED_AUDIO,
  estimatedTokens,
  fileIdOf,
  holdsFile,
  LISTENABLE_AUDIO_TYPES,
  MAX_FILE_TOKENS,
  ORIGINAL,
  pageImageName,
  previewOf,
  withExtension,
  type FilePiece,
  type LibraryFile,
} from '../domain/library-file.ts';
import type { LibraryRepository } from '../domain/library-repository.ts';
import type { User } from '../domain/user.ts';
import type { ChangeFeed } from './ports/change-feed.ts';
import type { Clock } from './ports/clock.ts';
import { DocumentTooLong, TooManyPages, UnreadableDocument, type DocumentReader } from './ports/document-reader.ts';
import type { FileStore } from './ports/file-store.ts';

export type Upload = { name: string; mediaType: string; bytes: Uint8Array };

type ReadFailure = 'file_too_large' | 'file_type_unsupported' | 'file_unreadable' | 'file_too_long';

/** `detail`: why, in English for the model, when the reason alone does not say it (a PDF's page count). */
type Refusal = { ok: false; reason: ReadFailure; detail?: string };

export type UploadResult = { ok: true; file: LibraryFile } | Refusal;

/** What the model gets of a file: text, and files (pictures, a PDF, a recording, a video) as their bytes. */
export type ModelPiece =
  | { type: 'text'; text: string }
  | { type: 'file'; mediaType: string; data: Uint8Array; filename?: string };

/** A downloaded file, read for one answer: nothing of it is stored. */
export type DownloadReading = { ok: true; name: string; kind: FileKind; size: number; pieces: ModelPiece[] } | Refusal;

type Picture = { name: string; bytes: Uint8Array };

/** A file read as at upload, before it is stored: its bytes are the converted recording, if it was one. */
type Reading = {
  name: string;
  kind: FileKind;
  mediaType: string;
  bytes: Uint8Array;
  content: FilePiece[];
  pictures: Picture[];
};

const EXTENSIONS: Record<string, string> = { 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' };

/** What the model reads of a file's kind, in French. */
const KIND_NAMES: Record<FileKind, string> = {
  image: 'image',
  pdf: 'PDF',
  word: 'Word',
  spreadsheet: 'Excel',
  text: 'texte',
  audio: 'enregistrement audio',
  video: 'vidéo',
};

/**
 * Each user's files. A file is read once, at upload, into what the model needs to know all of it: the whole text, and
 * a picture of every PDF page and of every image in a Word file; a recording or a video is its original. The answer to
 * the message it came with gets the whole file; later answers read it again whole when asked (`readAttachment`).
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
    const read = await this.#readUpload(upload);
    if (!read.ok) return read;
    const { reading } = read;
    const file: LibraryFile = {
      id: crypto.randomUUID(),
      userId: user.id,
      name: reading.name,
      kind: reading.kind,
      mediaType: reading.mediaType,
      size: reading.bytes.length,
      content: reading.content,
      createdAt: this.#clock.now(),
    };
    await this.#store.save(user.id, file.id, ORIGINAL, reading.bytes);
    for (const picture of reading.pictures) await this.#store.save(user.id, file.id, picture.name, picture.bytes);
    await this.#files.create(file);
    this.#changes.publish(user.id, { type: 'files' });
    return { ok: true, file };
  }

  /** A file the model downloaded, read like an upload and given as `expandFiles` would, but kept nowhere. */
  async readDownload(download: Upload, capabilities: readonly ModelCapability[]): Promise<DownloadReading> {
    const read = await this.#readUpload(download);
    if (!read.ok) return read;
    const { reading } = read;
    const bytesOf = async (name: string) =>
      name === ORIGINAL ? reading.bytes : (reading.pictures.find((picture) => picture.name === name)?.bytes ?? null);
    return {
      ok: true,
      name: reading.name,
      kind: reading.kind,
      size: reading.bytes.length,
      pieces: await this.#pieces(reading, bytesOf, capabilities),
    };
  }

  /**
   * A file attached or made in `conversationId`, read again whole for one answer (`read_attachment`); `null` for any
   * other id, and for a file of someone no longer in the conversation (`owners`: its participants), as `expandFiles`.
   */
  async readAttachment(
    conversationId: string,
    owners: readonly number[],
    id: string,
    capabilities: readonly ModelCapability[],
  ): Promise<{ file: LibraryFile; pieces: ModelPiece[] } | null> {
    const file = await this.#files.findById(id);
    if (!file || !owners.includes(file.userId)) return null;
    if (!holdsFile(await this.#conversations.messages(conversationId), file.id)) return null;
    const bytesOf = (name: string) => this.#store.read(file.userId, file.id, name);
    return { file, pieces: await this.#pieces(file, bytesOf, capabilities) };
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
   * Each file reaches the model in the turn it was sent: in the latest user message, each `file` part becomes the
   * file's whole content, between `<file>` tags, as the answering model can take it (`capabilities`): a PDF whole to a
   * model that reads files, else its pages as text and pictures; a recording to a model that listens, a video to one
   * that watches, else a note. In earlier messages a note names it, for `read_attachment`: a file sent again at every
   * answer cost its whole length each time, and a video several times the answer itself. `owners`: the conversation's
   * participants, whose files it may hold.
   */
  async expandFiles(
    owners: readonly number[],
    messages: readonly ChatMessage[],
    capabilities: readonly ModelCapability[],
  ): Promise<ChatMessage[]> {
    const latest = messages.findLastIndex((message) => message.role === 'user');
    return await Promise.all(
      messages.map(async (message, index) => {
        if (!message.parts.some((part) => part.type === 'file')) return message;
        const parts = await Promise.all(
          message.parts.map(async (part): Promise<ChatMessage['parts']> => {
            if (part.type !== 'file') return [part];
            const found = await this.#files.findById(fileIdOf(part.url) ?? '');
            const file = found && owners.includes(found.userId) ? found : null;
            if (!file) {
              const text = `[Le fichier « ${part.filename ?? 'fichier'} » a été supprimé de la bibliothèque : son contenu n'est plus disponible.]`;
              return [{ type: 'text', text }];
            }
            if (index !== latest) {
              const text = `[Fichier joint plus tôt : « ${file.name} » (${KIND_NAMES[file.kind]}, id ${file.id}). Il a été lu quand il a été envoyé et n'est plus joint : relis-le avec read_attachment si la question porte sur lui.]`;
              return [{ type: 'text', text }];
            }
            const bytesOf = (name: string) => this.#store.read(file.userId, file.id, name);
            const pieces = await this.#pieces(file, bytesOf, capabilities);
            return [
              { type: 'text', text: `<file id="${file.id}" name="${file.name.replaceAll('"', "'")}">` },
              ...pieces.map((piece): ChatMessage['parts'][number] =>
                piece.type === 'text'
                  ? piece
                  : {
                      type: 'file',
                      mediaType: piece.mediaType,
                      url: `data:${piece.mediaType};base64,${Buffer.from(piece.data).toString('base64')}`,
                      ...(piece.filename ? { filename: piece.filename } : {}),
                    },
              ),
              { type: 'text', text: '</file>' },
            ];
          }),
        );
        return { ...message, parts: parts.flat() };
      }),
    );
  }

  /**
   * Whether `user` may send `message`: each file it attaches is theirs, one they may `open`, or gone. A deleted or
   * unknown file leaks nothing: the model is told it was deleted.
   */
  async canAttach(user: User, message: ChatMessage): Promise<boolean> {
    const ids = message.parts.flatMap((part) => (part.type === 'file' ? [fileIdOf(part.url) ?? ''] : []));
    const files = await Promise.all(ids.map((id) => this.#files.findById(id)));
    const allowed = await Promise.all(files.map((file) => !file || this.#mayOpen(user, file)));
    return allowed.every(Boolean);
  }

  async #visible(user: User, id: string): Promise<LibraryFile | null> {
    const file = await this.#files.findById(id);
    return file && (await this.#mayOpen(user, file)) ? file : null;
  }

  async #mayOpen(user: User, file: LibraryFile): Promise<boolean> {
    return file.userId === user.id || (await this.#conversations.sharesFile(user.id, file.id, file.userId));
  }

  /** Read as at upload: refused when too big, of a kind the app does not read, broken, or too long for the model. */
  async #readUpload(upload: Upload): Promise<{ ok: true; reading: Reading } | Refusal> {
    if (upload.bytes.length > MAX_FILE_BYTES) return { ok: false, reason: 'file_too_large' };
    const kind = fileKindOf(upload.name, upload.mediaType);
    if (!kind) return { ok: false, reason: 'file_type_unsupported' };
    const reading: Reading = {
      name: cleanFileName(upload.name),
      kind,
      mediaType: mediaTypeOf(kind, upload.name, upload.mediaType),
      bytes: upload.bytes,
      content: [],
      pictures: [],
    };
    try {
      if (kind === 'audio' && !LISTENABLE_AUDIO_TYPES[reading.mediaType]) {
        reading.bytes = await this.#reader.convertAudio(reading.bytes);
        reading.mediaType = CONVERTED_AUDIO.mediaType;
        reading.name = withExtension(reading.name, CONVERTED_AUDIO.extension);
      }
      reading.content = await this.#read(kind, reading.mediaType, reading.bytes, reading.pictures);
    } catch (error) {
      if (error instanceof TooManyPages) return { ok: false, reason: 'file_too_long', detail: error.message };
      if (error instanceof DocumentTooLong) return { ok: false, reason: 'file_too_long' };
      if (error instanceof UnreadableDocument) return { ok: false, reason: 'file_unreadable' };
      throw error;
    }
    if (reading.content.length === 0) return { ok: false, reason: 'file_unreadable' };
    if (estimatedTokens(reading.content) > MAX_FILE_TOKENS) return { ok: false, reason: 'file_too_long' };
    return { ok: true, reading };
  }

  async #pieces(
    file: Pick<LibraryFile, 'name' | 'kind' | 'content'>,
    bytesOf: (name: string) => Promise<Uint8Array | null>,
    capabilities: readonly ModelCapability[],
  ): Promise<ModelPiece[]> {
    if (file.kind === 'pdf' && capabilities.includes('file')) {
      const data = await bytesOf(ORIGINAL);
      if (data) return [{ type: 'file', mediaType: 'application/pdf', data, filename: file.name }];
    }
    return await Promise.all(
      file.content.map(async (piece): Promise<ModelPiece> => {
        if (piece.type === 'text') return piece;
        if (piece.type === 'media') {
          const note = mediaNote(piece.mediaType, capabilities);
          if (note) return { type: 'text', text: note };
        }
        const data = await bytesOf(piece.name);
        if (!data) return { type: 'text', text: '[Une partie de ce fichier est manquante.]' };
        return { type: 'file', mediaType: piece.mediaType, data, filename: file.name };
      }),
    );
  }

  async #read(kind: FileKind, mediaType: string, bytes: Uint8Array, pictures: Picture[]): Promise<FilePiece[]> {
    switch (kind) {
      case 'image':
        return [{ type: 'image', name: ORIGINAL, mediaType }];
      case 'audio':
      case 'video':
        return [{ type: 'media', name: ORIGINAL, mediaType }];
      case 'text': {
        const text = new TextDecoder().decode(bytes);
        // Any extension reads as text: a binary file under a code file's name is not text.
        if (text.includes('\u0000')) throw new UnreadableDocument('Not a text file.');
        return text.trim() ? [{ type: 'text', text }] : [];
      }
      case 'pdf': {
        const pages = await this.#reader.readPdf(bytes);
        const firstWithout = pages.findIndex((page) => !page.image);
        return pages.flatMap((page, index) => {
          const pieces: FilePiece[] = [];
          if (index === firstWithout) {
            pieces.push({
              type: 'text',
              text: `[Les pages ${index + 1} à ${pages.length} n'ont que leur texte : leurs images (graphiques, schémas, pages scannées) ne sont pas jointes.]`,
            });
          }
          const text = page.text || (page.image ? '(No text layer: read the picture.)' : '(Page sans texte.)');
          pieces.push({ type: 'text', text: `Page ${index + 1} of ${pages.length}:\n${text}` });
          if (page.image) {
            const name = pageImageName(index + 1);
            pictures.push({ name, bytes: page.image });
            pieces.push({ type: 'image', name, mediaType: 'image/jpeg' });
          }
          return pieces;
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

/** Why the model does not get a recording or a video, in French as everything it reads; `null`: it gets it. */
function mediaNote(mediaType: string, capabilities: readonly ModelCapability[]): string | null {
  if (mediaType.startsWith('audio/')) {
    return capabilities.includes('audio')
      ? null
      : "[Enregistrement audio : le modèle qui répond ne peut pas écouter l'audio. Dis-le à l'utilisateur s'il te demande ce qu'il contient.]";
  }
  return capabilities.includes('video')
    ? null
    : "[Vidéo : le modèle qui répond ne peut pas regarder les vidéos. Dis-le à l'utilisateur s'il te demande ce qu'elle montre.]";
}
