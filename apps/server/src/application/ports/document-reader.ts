/**
 * A PDF page as the model gets it: its text, and its picture for everything the text misses (charts, stamps, scans);
 * `null` past the pages that are rendered.
 */
export type PdfPage = { text: string; image: Uint8Array | null };

/** Word content in order. Headers and footers are not read (mammoth's limit). */
export type WordPiece = { type: 'text'; text: string } | { type: 'image'; bytes: Uint8Array; mediaType: string };

export interface DocumentReader {
  /** Throws `UnreadableDocument` for a broken or password-protected file, `TooManyPages` for a huge one. */
  readPdf(bytes: Uint8Array): Promise<PdfPage[]>;
  /** Throws `UnreadableDocument` for a broken file. */
  readWord(bytes: Uint8Array): Promise<WordPiece[]>;
  /** Each sheet as a table of text. Throws `UnreadableDocument` for a broken file, `DocumentTooLong` for a huge one. */
  readSpreadsheet(bytes: Uint8Array): Promise<string>;
  /**
   * A recording in a format the models do not take, as `CONVERTED_AUDIO` (m4a). Throws `UnreadableDocument` for a
   * broken file, `DocumentTooLong` when converting it takes too long.
   */
  convertAudio(bytes: Uint8Array): Promise<Uint8Array>;
}

export class UnreadableDocument extends Error {}

/** A document bigger than the model can read whole: refused at upload, never read in part. */
export class DocumentTooLong extends Error {}

/** A PDF past the pages the models read natively: its message, in English, is told to the model. */
export class TooManyPages extends DocumentTooLong {}
