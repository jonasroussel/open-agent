import { dirname } from 'node:path';

import type { SpreadsheetCell, SpreadsheetFormat, SpreadsheetSheet } from '@open-agent/shared';
import { Resvg } from '@resvg/resvg-js';
import ExcelJS from 'exceljs';
import { lexer, type MarkedToken, type Token, type Tokens } from 'marked';
import pdfmake, { type Content, type DocumentDefinition } from 'pdfmake';
import QRCode from 'qrcode';
import * as vega from 'vega';
import { expressionInterpreter } from 'vega-interpreter';
import { compile, type TopLevelSpec } from 'vega-lite';

import { CannotMake, type FileMaker, type PdfImage } from '../../application/ports/file-maker.ts';

/** pdfmake's Roboto, for the PDFs and the charts' text: the image has no system fonts. */
const FONTS = dirname(Bun.resolveSync('pdfmake/build/fonts/Roboto/Roboto-Regular.ttf', import.meta.dir));
const BRAND = '#4f46e5';

/** `text` keeps Excel's default: a cell typed later is still read as a number or a date. */
const NUMBER_FORMATS: Record<Exclude<SpreadsheetFormat, 'text'>, string> = {
  number: '#,##0.00',
  integer: '#,##0',
  euro: '#,##0.00 "€"',
  percent: '0.0 %',
  date: 'dd/mm/yyyy',
};

/** A chart larger than this is refused: drawn twice as big, it would take the server's memory. */
const MAX_CHART_SIDE = 2_000;

/**
 * Excel with exceljs, PDFs with pdfmake from Markdown (marked), charts with Vega-Lite drawn by resvg, QR codes with
 * qrcode. Nothing here reads the network or the disk, but for the fonts.
 */
export class OfficeFileMaker implements FileMaker {
  constructor() {
    // A PDF shows only the pictures it is given: no address, no file of the server.
    pdfmake.setUrlAccessPolicy(() => false);
    pdfmake.setLocalAccessPolicy((path) => path.startsWith(FONTS));
    pdfmake.addFonts({
      Roboto: {
        normal: `${FONTS}/Roboto-Regular.ttf`,
        bold: `${FONTS}/Roboto-Medium.ttf`,
        italics: `${FONTS}/Roboto-Italic.ttf`,
        bolditalics: `${FONTS}/Roboto-MediumItalic.ttf`,
      },
    });
  }

  async spreadsheet(sheets: readonly SpreadsheetSheet[]): Promise<Uint8Array> {
    const workbook = new ExcelJS.Workbook();
    const names = new Set<string>();
    for (const sheet of sheets) {
      const worksheet = workbook.addWorksheet(uniqueSheetName(sheet.name, names), {
        views: [{ state: 'frozen', ySplit: 1 }],
      });
      worksheet.columns = sheet.columns.map((column, index) => ({
        header: column.header,
        width:
          column.width ??
          columnWidth(
            column.header,
            sheet.rows.map((row) => row[index] ?? null),
          ),
        style: column.format && column.format !== 'text' ? { numFmt: NUMBER_FORMATS[column.format] } : {},
      }));
      for (const row of sheet.rows) {
        worksheet.addRow(row.map((cell, index) => cellValue(cell, sheet.columns[index]?.format)));
      }
      const header = worksheet.getRow(1);
      header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } };
      if (sheet.columns.length > 0) {
        worksheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columns.length } };
      }
    }
    return new Uint8Array(await workbook.xlsx.writeBuffer());
  }

  async pdf(markdown: string, images: ReadonlyMap<string, PdfImage>, landscape: boolean): Promise<Uint8Array> {
    const document: DocumentDefinition = {
      pageSize: 'A4',
      pageOrientation: landscape ? 'landscape' : 'portrait',
      pageMargins: [50, 50, 50, 60],
      content: blocks(lexer(markdown), images),
      footer: (page: number, pages: number) =>
        pages > 1 ? { text: `${page} / ${pages}`, alignment: 'center', fontSize: 9, color: '#888888' } : null,
      defaultStyle: { font: 'Roboto', fontSize: 11, lineHeight: 1.25 },
      styles: {
        h1: { fontSize: 20, bold: true, color: BRAND, margin: [0, 4, 0, 10] },
        h2: { fontSize: 15, bold: true, margin: [0, 10, 0, 6] },
        h3: { fontSize: 12.5, bold: true, margin: [0, 8, 0, 4] },
        quote: { italics: true, color: '#555555' },
        code: { fontSize: 9.5, background: '#f1f1f4' },
        caption: { fontSize: 9, italics: true, color: '#666666', alignment: 'center', margin: [0, 2, 0, 10] },
      },
    };
    try {
      return new Uint8Array(await pdfmake.createPdf(document).getBuffer());
    } catch (error) {
      throw new CannotMake(`The PDF could not be made: ${messageOf(error)}`);
    }
  }

  async chart(spec: Record<string, unknown>): Promise<Uint8Array> {
    // Vega logs a failed load and draws without it: a URL is refused before, and the loader refuses it again.
    if (namesUrl(spec)) throw new CannotMake('A chart takes its data inline (data.values), never from a URL.');
    let svg: string;
    try {
      const compiled = compile(spec as unknown as TopLevelSpec, {
        config: {
          font: 'Roboto',
          background: 'white',
          // A bar per category would otherwise be 20 pixels wide: the whole chart takes 640 × 360 instead.
          view: { continuousWidth: 640, continuousHeight: 360, discreteWidth: 640, discreteHeight: 360 },
          mark: { color: BRAND },
          range: { category: ['#4f46e5', '#f59e0b', '#10b981', '#ef4444', '#06b6d4', '#a855f7', '#84cc16', '#ec4899'] },
        },
      }).spec;
      // The interpreter evaluates the spec's expressions without generating code; the loader refuses any URL.
      const view = new vega.View(vega.parse(compiled, undefined, { ast: true }), {
        expr: expressionInterpreter,
        renderer: 'none',
        loader: refusingLoader(),
      });
      await view.runAsync();
      if (view.width() > MAX_CHART_SIDE || view.height() > MAX_CHART_SIDE) {
        throw new CannotMake(`The chart is larger than ${MAX_CHART_SIDE} pixels: make it smaller.`);
      }
      // resvg would read a picture's path from the disk: a chart has none.
      svg = (await view.toSVG()).replaceAll(/<image\b[^>]*>/g, '');
      view.finalize();
    } catch (error) {
      if (error instanceof CannotMake) throw error;
      throw new CannotMake(`The chart could not be drawn: ${messageOf(error)}`);
    }
    const resvg = new Resvg(svg, {
      font: { fontDirs: [FONTS], loadSystemFonts: false, defaultFontFamily: 'Roboto' },
      fitTo: { mode: 'zoom', value: 2 },
    });
    return new Uint8Array(resvg.render().asPng());
  }

  async qrCode(text: string): Promise<Uint8Array> {
    try {
      return new Uint8Array(await QRCode.toBuffer(text, { width: 800, margin: 2, errorCorrectionLevel: 'M' }));
    } catch (error) {
      throw new CannotMake(`No QR code for this text: ${messageOf(error)}`);
    }
  }
}

function messageOf(error: unknown): string {
  return String(error instanceof Error ? error.message : error).slice(0, 300);
}

/** Whether a spec loads anything: `url` anywhere (data, lookups, image marks), the inline rows aside. */
function namesUrl(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(namesUrl);
  if (typeof value !== 'object' || value === null) return false;
  return Object.entries(value).some(([key, inner]) => key === 'url' || (key !== 'values' && namesUrl(inner)));
}

/** Excel's rules: 31 characters at most, none of `[]:*?/\`, each name once. */
function uniqueSheetName(wanted: string, taken: Set<string>): string {
  const base =
    wanted
      .replaceAll(/[[\]:*?/\\]/g, ' ')
      .trim()
      .slice(0, 31) || 'Feuille';
  let name = base;
  for (let count = 2; taken.has(name.toLowerCase()); count += 1) name = `${base.slice(0, 27)} (${count})`;
  taken.add(name.toLowerCase());
  return name;
}

function columnWidth(header: string, cells: SpreadsheetCell[]): number {
  const longest = Math.max(header.length, ...cells.map((cell) => (cell === null ? 0 : String(cell).length)));
  return Math.min(Math.max(longest + 2, 8), 60);
}

function cellValue(cell: SpreadsheetCell, format: SpreadsheetFormat | undefined): ExcelJS.CellValue {
  if (typeof cell !== 'string') return cell;
  if (cell.startsWith('=')) return { formula: cell.slice(1) };
  if (format === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(cell)) return new Date(`${cell}T00:00:00Z`);
  return cell;
}

function refusingLoader(): vega.Loader {
  const loader = vega.loader();
  loader.sanitize = () =>
    Promise.reject(new CannotMake('A chart takes its data inline (data.values), never from a URL.'));
  return loader;
}

function blocks(tokens: readonly Token[], images: ReadonlyMap<string, PdfImage>): Content[] {
  return tokens.flatMap((token): Content[] => {
    const known = token as MarkedToken;
    switch (known.type) {
      case 'heading':
        return [{ text: inline(known.tokens), style: `h${Math.min(known.depth, 3)}` }];
      case 'paragraph': {
        // Models write a line of "\" for an empty line, as in a letter's space to sign.
        if (known.raw.trim() === '\\') return [{ text: ' ' }];
        const pictures = known.tokens.flatMap((child) => (child.type === 'image' ? [child as Tokens.Image] : []));
        // A paragraph of pictures only: each one full width, with its caption.
        if (pictures.length > 0 && known.tokens.every((child) => child.type === 'image' || !child.raw.trim())) {
          return pictures.flatMap((picture) => figure(picture, images));
        }
        return [{ text: inline(known.tokens), margin: [0, 0, 0, 8] }];
      }
      case 'list': {
        const items = known.items.map((item) => {
          const content = blocks(item.tokens, images);
          // A task's box and its words share a line.
          if (!item.task || content.length < 2) return { stack: content };
          const [box, words, ...rest] = content;
          return { stack: [{ text: [box!, ' ', words!] }, ...rest] };
        });
        return [
          known.ordered
            ? { ol: items, start: typeof known.start === 'number' ? known.start : 1, margin: [0, 0, 0, 8] }
            : { ul: items, margin: [0, 0, 0, 8] },
        ];
      }
      case 'checkbox':
        return [{ text: known.checked ? '[x]' : '[  ]', bold: true }];
      case 'table': {
        const row = (cells: Tokens.TableCell[], bold: boolean) =>
          cells.map((cell, index) => ({ text: inline(cell.tokens), bold, alignment: known.align[index] ?? 'left' }));
        return [
          {
            table: {
              headerRows: 1,
              widths: known.header.map(() => '*'),
              body: [row(known.header, true), ...known.rows.map((cells) => row(cells, false))],
            },
            layout: 'lightHorizontalLines',
            margin: [0, 2, 0, 10],
          },
        ];
      }
      case 'blockquote':
        return [{ stack: blocks(known.tokens, images), style: 'quote', margin: [16, 0, 0, 8] }];
      case 'code':
        return [{ text: known.text, style: 'code', preserveLeadingSpaces: true, margin: [0, 0, 0, 8] }];
      case 'hr':
        return [
          { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 495, y2: 0, lineColor: '#dddddd' }], margin: [0, 6, 0, 12] },
        ];
      case 'text':
        return [{ text: known.tokens ? inline(known.tokens) : unescape(known.text) }];
      default:
        return [];
    }
  });
}

function figure(picture: Tokens.Image, images: ReadonlyMap<string, PdfImage>): Content[] {
  const image = images.get(picture.href);
  if (!image) throw new CannotMake(`No image "${picture.href}": use the id of an image of the user's library.`);
  return [
    {
      image: `data:${image.mediaType};base64,${Buffer.from(image.bytes).toString('base64')}`,
      fit: [495, 420],
      alignment: 'center',
      margin: [0, 4, 0, picture.text ? 0 : 10],
    },
    ...(picture.text ? [{ text: picture.text, style: 'caption' }] : []),
  ];
}

/** A run of text and how it looks: bold, italics, a link… */
type Inline = { text: string; [key: string]: unknown };
type Look = Omit<Inline, 'text'>;

function inline(tokens: readonly Token[], style: Look = {}): Inline[] {
  return tokens.flatMap((token): Inline[] => {
    const known = token as MarkedToken;
    switch (known.type) {
      case 'strong':
        return inline(known.tokens, { ...style, bold: true });
      case 'em':
        return inline(known.tokens, { ...style, italics: true });
      case 'del':
        return inline(known.tokens, { ...style, decoration: 'lineThrough' });
      case 'codespan':
        return [{ ...style, text: unescape(known.text), style: 'code' }];
      case 'link':
        return inline(known.tokens, { ...style, link: known.href, color: BRAND, decoration: 'underline' });
      case 'br':
        return [{ ...style, text: '\n' }];
      case 'image':
        // A picture inside a sentence: its caption stands in for it.
        return [{ ...style, text: known.text }];
      case 'text':
        return known.tokens ? inline(known.tokens, style) : [{ ...style, text: unescape(known.text) }];
      case 'escape':
      case 'html':
        return [{ ...style, text: unescape(known.text) }];
      default:
        return [];
    }
  });
}

/** marked escapes `&`, `<`, `>` and quotes in text tokens; a PDF shows them as they are. */
function unescape(text: string): string {
  return text
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&amp;', '&');
}
