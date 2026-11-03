/** What a file is for the model: an image it sees, or text read out of it (a spreadsheet's sheets as tables). */
export type FileKind = 'image' | 'pdf' | 'word' | 'spreadsheet' | 'text';

export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_FILES_PER_MESSAGE = 5;

/** What may be uploaded. The extension decides when the browser gives no media type, as for some `.md` and `.csv`. */
const FILE_TYPES: Record<FileKind, { mediaTypes: readonly string[]; extensions: readonly string[] }> = {
  image: {
    mediaTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
    extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'],
  },
  pdf: { mediaTypes: ['application/pdf'], extensions: ['pdf'] },
  word: {
    mediaTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    extensions: ['docx'],
  },
  spreadsheet: {
    mediaTypes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    extensions: ['xlsx'],
  },
  text: { mediaTypes: ['text/plain', 'text/markdown', 'text/csv'], extensions: ['txt', 'md', 'csv'] },
};

const KINDS = Object.keys(FILE_TYPES) as FileKind[];

/** The `accept` of the file inputs. */
export const FILE_ACCEPT = KINDS.flatMap((kind) => [
  ...FILE_TYPES[kind].mediaTypes,
  ...FILE_TYPES[kind].extensions.map((extension) => `.${extension}`),
]).join(',');

/** `null`: not a file the app reads. A known media type wins; an unknown or empty one falls back to the extension. */
export function fileKindOf(name: string, mediaType: string): FileKind | null {
  const type = mediaType.split(';')[0]!.trim().toLowerCase();
  const byType = KINDS.find((kind) => FILE_TYPES[kind].mediaTypes.includes(type));
  if (byType) return byType;
  if (type && type !== 'application/octet-stream') return null;
  const extension = name.split('.').pop()?.toLowerCase() ?? '';
  return KINDS.find((kind) => FILE_TYPES[kind].extensions.includes(extension)) ?? null;
}

/** The media type the app stores and serves for a kind, whatever the browser sent. */
export function mediaTypeOf(kind: FileKind, name: string, mediaType: string): string {
  const type = mediaType.split(';')[0]!.trim().toLowerCase();
  if (FILE_TYPES[kind].mediaTypes.includes(type)) return type;
  if (kind === 'image') return name.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
  return FILE_TYPES[kind].mediaTypes[0]!;
}
