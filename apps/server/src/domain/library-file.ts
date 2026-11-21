import { MAX_FILES_PER_MESSAGE, type FileKind } from '@open-agent/shared';

import type { ChatMessage } from './conversation.ts';

/**
 * What the model reads of a file, in order. Nothing is cut: the user must be able to ask about any line or picture of
 * it. Pictures are stored next to the original, under `name`. A recording or a video is the original itself, given to
 * the model as it is.
 */
export type FilePiece =
  | { type: 'text'; text: string }
  | { type: 'image'; name: string; mediaType: string }
  | { type: 'media'; name: string; mediaType: string };

export type LibraryFile = {
  /** A UUID: also the file's address, `/api/files/:id`. */
  id: string;
  userId: number;
  name: string;
  kind: FileKind;
  mediaType: string;
  size: number;
  content: readonly FilePiece[];
  createdAt: Date;
};

/** The stored original, under this name. */
export const ORIGINAL = 'original';

/** The stored picture of a PDF page, counted from 1. */
export function pageImageName(page: number): string {
  return `page-${page}.jpg`;
}

/**
 * The recordings the models take as they are (OpenRouter's audio formats). Any other, as the `audio/webm` of Chrome's
 * recorder, is converted at upload to `CONVERTED_AUDIO`.
 */
export const LISTENABLE_AUDIO_TYPES: Record<string, true> = {
  'audio/mpeg': true,
  'audio/mp4': true,
  'audio/wav': true,
  'audio/ogg': true,
  'audio/aac': true,
  'audio/flac': true,
};

export const CONVERTED_AUDIO = { mediaType: 'audio/mp4', extension: 'm4a' } as const;

/** "note.webm" becomes "note.m4a": the name follows the converted recording. */
export function withExtension(name: string, extension: string): string {
  const dot = name.lastIndexOf('.');
  return `${dot > 0 ? name.slice(0, dot) : name}.${extension}`;
}

/** What shows a file in "My files": the image itself, or a PDF's first page. Other files show their kind's icon. */
export function previewOf(file: Pick<LibraryFile, 'kind' | 'mediaType'>): { name: string; mediaType: string } | null {
  if (file.kind === 'image') return { name: ORIGINAL, mediaType: file.mediaType };
  if (file.kind === 'pdf') return { name: pageImageName(1), mediaType: 'image/jpeg' };
  return null;
}

/**
 * More than the model can read along with a conversation (its context is 1 million tokens): such a file is refused
 * at upload rather than read in part.
 */
export const MAX_FILE_TOKENS = 600_000;

/** The tools that make files for the user; a file one of them made belongs to the conversation it was made in. */
export const MAKING_TOOL_NAMES = [
  'generate_image',
  'create_spreadsheet',
  'create_pdf',
  'create_chart',
  'create_qr_code',
] as const;

export type MakingToolName = (typeof MAKING_TOOL_NAMES)[number];

/** A text token is about 3 characters in French; DeepSeek counts a page image in hundreds of tokens (measured: 449). */
export function estimatedTokens(content: readonly FilePiece[]): number {
  return content.reduce((total, piece) => total + (piece.type === 'text' ? Math.ceil(piece.text.length / 3) : 1000), 0);
}

/** A name to show and to send back as `filename`: no folders, no control characters, never empty. */
export function cleanFileName(raw: string): string {
  const name = [...(raw.split(/[\\/]/).pop() ?? '')]
    .filter((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127)
    .join('')
    .trim()
    .slice(0, 200);
  return name || 'file';
}

const FILE_URL = /^\/api\/files\/([0-9a-f-]{36})$/;

/** The library file a message's `file` part points to; `null` for any other address. */
export function fileIdOf(url: string): string | null {
  return FILE_URL.exec(url)?.[1] ?? null;
}

const MADE_BY: Record<string, true> = Object.fromEntries(MAKING_TOOL_NAMES.map((name) => [`tool-${name}`, true]));

/**
 * Whether `messages` attach the file or hold it as a making tool's output, as `sharesFile` does for a whole
 * conversation: an id merely named there (a listed or read file, a tool's input) does not count.
 */
export function holdsFile(messages: readonly ChatMessage[], fileId: string): boolean {
  return messages.some((message) =>
    message.parts.some((part) => {
      if (part.type === 'file') return fileIdOf(part.url) === fileId;
      return (
        MADE_BY[part.type] === true && 'output' in part && (part.output as { id?: unknown } | undefined)?.id === fileId
      );
    }),
  );
}

/**
 * Messages may only attach files of the library, a few at a time: never a link or inline data from the browser, which
 * would skip the reading done at upload.
 */
export function attachmentsAreValid(messages: readonly ChatMessage[]): boolean {
  return messages.every((message) => {
    const files = message.parts.filter((part) => part.type === 'file');
    return files.length <= MAX_FILES_PER_MESSAGE && files.every((part) => fileIdOf(part.url) !== null);
  });
}

/** "cv.pdf, photo.jpg": what the pre-analysis and the title see of a message's files. */
export function attachedNames(message: ChatMessage): string {
  return message.parts.flatMap((part) => (part.type === 'file' ? [part.filename ?? 'file'] : [])).join(', ');
}
