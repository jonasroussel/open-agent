/** A PDF page as the model gets it: its text, and its picture for everything the text misses (charts, stamps, scans). */
export type PdfPage = { text: string; image: Uint8Array };

/** Word content in order. Headers and footers are not read (mammoth's limit). */
export type WordPiece = { type: 'text'; text: string } | { type: 'image'; bytes: Uint8Array; mediaType: string };

export interface DocumentReader {
  /** Throws `UnreadableDocument` for a broken or password-protected file. */
  readPdf(bytes: Uint8Array): Promise<PdfPage[]>;
  /** Throws `UnreadableDocument` for a broken file. */
  readWord(bytes: Uint8Array): Promise<WordPiece[]>;
  /** Each sheet as a table of text. Throws `UnreadableDocument` for a broken file, `DocumentTooLong` for a huge one. */
  readSpreadsheet(bytes: Uint8Array): Promise<string>;
}

export class UnreadableDocument extends Error {}

/** A document bigger than the model can read whole: refused at upload, never read in part. */
export class DocumentTooLong extends Error {}
