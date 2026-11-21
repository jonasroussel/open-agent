/**
 * What a file is for the model: an image it sees, a recording it hears, a video it watches, or text read out of it (a
 * spreadsheet's sheets as tables).
 */
export type FileKind = 'image' | 'pdf' | 'word' | 'spreadsheet' | 'text' | 'audio' | 'video';

export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_FILES_PER_MESSAGE = 5;

/**
 * What may be uploaded, each accepted media type and extension with the media type the app stores and serves for it.
 * Text of every kind (HTML, code) is served as plain text: the browser must never run an uploaded page.
 */
const FILE_TYPES: Record<FileKind, { mediaTypes: Record<string, string>; extensions: Record<string, string> }> = {
  image: {
    mediaTypes: {
      'image/jpeg': 'image/jpeg',
      'image/png': 'image/png',
      'image/webp': 'image/webp',
      'image/gif': 'image/gif',
    },
    extensions: { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' },
  },
  pdf: { mediaTypes: { 'application/pdf': 'application/pdf' }, extensions: { pdf: 'application/pdf' } },
  word: {
    mediaTypes: {
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    },
    extensions: { docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  },
  spreadsheet: {
    mediaTypes: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    },
    extensions: { xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  },
  // `audio/webm` is what Chrome's recorder makes: converted at upload, the models do not take it.
  audio: {
    mediaTypes: {
      'audio/mpeg': 'audio/mpeg',
      'audio/mp3': 'audio/mpeg',
      'audio/mp4': 'audio/mp4',
      'audio/m4a': 'audio/mp4',
      'audio/x-m4a': 'audio/mp4',
      'audio/wav': 'audio/wav',
      'audio/x-wav': 'audio/wav',
      'audio/wave': 'audio/wav',
      'audio/ogg': 'audio/ogg',
      'audio/opus': 'audio/ogg',
      'audio/aac': 'audio/aac',
      'audio/x-aac': 'audio/aac',
      'audio/flac': 'audio/flac',
      'audio/x-flac': 'audio/flac',
      'audio/webm': 'audio/webm',
    },
    extensions: {
      mp3: 'audio/mpeg',
      m4a: 'audio/mp4',
      wav: 'audio/wav',
      ogg: 'audio/ogg',
      oga: 'audio/ogg',
      opus: 'audio/ogg',
      aac: 'audio/aac',
      flac: 'audio/flac',
      weba: 'audio/webm',
    },
  },
  video: {
    mediaTypes: { 'video/mp4': 'video/mp4', 'video/quicktime': 'video/quicktime', 'video/webm': 'video/webm' },
    extensions: { mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm' },
  },
  text: {
    mediaTypes: {
      'text/plain': 'text/plain',
      'text/markdown': 'text/markdown',
      'text/x-markdown': 'text/markdown',
      'text/csv': 'text/csv',
      ...Object.fromEntries(
        [
          'text/tab-separated-values',
          'text/html',
          'application/xhtml+xml',
          'text/xml',
          'application/xml',
          'application/json',
          'application/ld+json',
          'text/yaml',
          'text/x-yaml',
          'application/yaml',
          'application/x-yaml',
          'text/css',
          'text/javascript',
          'application/javascript',
          'application/typescript',
          'text/x-python',
          'text/x-script.python',
          'text/x-c',
          'text/x-java-source',
          'text/x-sh',
          'application/x-sh',
          'application/sql',
          'application/toml',
          'text/vtt',
          'application/x-subrip',
        ].map((type) => [type, 'text/plain']),
      ),
    },
    extensions: {
      md: 'text/markdown',
      markdown: 'text/markdown',
      csv: 'text/csv',
      ...Object.fromEntries(
        // Data, then code.
        'txt tsv json html htm xml yaml yml log ini toml srt vtt js mjs cjs jsx ts tsx py java kt swift c h cpp hpp cs go rs rb php sql sh css scss vue svelte lua r pl'
          .split(' ')
          .map((extension) => [extension, 'text/plain']),
      ),
    },
  },
};

const KINDS = Object.keys(FILE_TYPES) as FileKind[];
const MEDIA_KINDS: FileKind[] = ['image', 'video'];
/** Text extensions Android's `MimeTypeMap` reads as a video. */
const ANDROID_MEDIA_EXTENSIONS = ['.ts'];

function acceptOf(kinds: FileKind[]): string {
  return kinds
    .flatMap((kind) => [
      ...Object.keys(FILE_TYPES[kind].mediaTypes),
      ...Object.keys(FILE_TYPES[kind].extensions).map((extension) => `.${extension}`),
    ])
    .join(',');
}

/** The `accept` of the file inputs. */
export const FILE_ACCEPT = acceptOf(KINDS);
/** Images and videos only: on a phone, the camera and photo picker. */
export const MEDIA_ACCEPT = acceptOf(MEDIA_KINDS);
/**
 * Every other kind, for a phone's documents field when the file manager cannot be opened directly. Without the
 * extensions Android maps to a video type (`.ts` is `video/mp2t`): Chrome would add the camcorder to the chooser.
 */
export const DOCUMENT_ACCEPT = acceptOf(KINDS.filter((kind) => !MEDIA_KINDS.includes(kind)))
  .split(',')
  .filter((entry) => !ANDROID_MEDIA_EXTENSIONS.includes(entry))
  .join(',');

/**
 * `null`: not a file the app reads. A known media type wins; an unknown or empty one falls back to the extension. A
 * text extension wins over any media type: browsers name code files oddly (`.ts` as `video/mp2t`), and text is only
 * read, never run.
 */
export function fileKindOf(name: string, mediaType: string): FileKind | null {
  const type = bareType(mediaType);
  const byType = KINDS.find((kind) => FILE_TYPES[kind].mediaTypes[type]);
  if (byType) return byType;
  const extension = extensionOf(name);
  if (FILE_TYPES.text.extensions[extension]) return 'text';
  if (type && type !== 'application/octet-stream') return null;
  return KINDS.find((kind) => FILE_TYPES[kind].extensions[extension]) ?? null;
}

/** The media type the app stores and serves for a kind, whatever the browser sent. */
export function mediaTypeOf(kind: FileKind, name: string, mediaType: string): string {
  const types = FILE_TYPES[kind];
  return (
    types.mediaTypes[bareType(mediaType)] ?? types.extensions[extensionOf(name)] ?? Object.values(types.mediaTypes)[0]!
  );
}

function bareType(mediaType: string): string {
  return mediaType.split(';')[0]!.trim().toLowerCase();
}

function extensionOf(name: string): string {
  return name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
}
