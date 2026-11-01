import { MAX_FILES_PER_MESSAGE, type FileKind } from '@open-agent/shared';

import type { ChatMessage } from './conversation.ts';

/**
 * What the model reads of a file, in order. Nothing is cut: the user must be able to ask about any line or picture of
 * it. Pictures are stored next to the original, under `name`.
 */
export type FilePiece = { type: 'text'; text: string } | { type: 'image'; name: string; mediaType: string };

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
