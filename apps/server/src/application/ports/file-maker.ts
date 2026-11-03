import type { SpreadsheetSheet } from '@open-agent/shared';

import { ToolRefusal } from './context-services.ts';

/** A picture a PDF shows, by the id its Markdown names it with. JPEG and PNG only. */
export type PdfImage = { bytes: Uint8Array; mediaType: 'image/jpeg' | 'image/png' };

/** Files the model makes for the user, from what it wrote. */
export interface FileMaker {
  /** An `.xlsx` workbook. */
  spreadsheet(sheets: readonly SpreadsheetSheet[]): Promise<Uint8Array>;
  /** An A4 PDF from Markdown; `![caption](id)` shows `images.get(id)`. */
  pdf(markdown: string, images: ReadonlyMap<string, PdfImage>, landscape: boolean): Promise<Uint8Array>;
  /** A PNG of a Vega-Lite chart. Throws `CannotMake` for a spec it cannot draw. */
  chart(spec: Record<string, unknown>): Promise<Uint8Array>;
  /** A PNG QR code of `text`. Throws `CannotMake` past what a QR code holds. */
  qrCode(text: string): Promise<Uint8Array>;
}

/** What the model asked for cannot be made: it reads why, and can fix its request. */
export class CannotMake extends ToolRefusal {}
