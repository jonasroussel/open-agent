import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import ExcelJS from 'exceljs';
import mammoth from 'mammoth';

import {
  DocumentTooLong,
  UnreadableDocument,
  type DocumentReader,
  type PdfPage,
  type WordPiece,
} from '../../application/ports/document-reader.ts';

/** Enough to read small print on an A4 page, at a few hundred tokens per picture. */
const PAGE_DPI = 110;
/** One upload must not pin the server: a tool run longer than this is stopped. */
const COMMAND_TIMEOUT_MS = 30_000;
/** A compressed file expands far past the 20 MB it weighs: what a tool prints is read up to this. */
const MAX_OUTPUT_CHARACTERS = 2_000_000;
/** Rendered pages: far past what the model reads at once, and every page is a picture to make. */
const MAX_PDF_PAGES = 100;
/** Pictures kept from a Word file, whose zip may hold far more than the uploaded 20 MB. */
const MAX_WORD_IMAGE_BYTES = 20 * 1024 * 1024;
/** A spreadsheet's zip, expanded: exceljs reads it all in memory, so a zip bomb is refused before. */
const MAX_SPREADSHEET_BYTES = 100 * 1024 * 1024;
/** Word may embed EMF or WMF drawings, which the model cannot see. */
const VISIBLE_IMAGE_TYPES: Record<string, true> = {
  'image/png': true,
  'image/jpeg': true,
  'image/gif': true,
  'image/webp': true,
};
/** PDFs with Poppler (`pdftotext`, `pdftoppm`; `poppler-utils` in the image), Word files with mammoth, Excel with exceljs. */
export class PopplerMammothReader implements DocumentReader {
  async readPdf(bytes: Uint8Array): Promise<PdfPage[]> {
    const folder = await mkdtemp(join(tmpdir(), 'open-agent-pdf-'));
    try {
      const pdf = join(folder, 'document.pdf');
      await Bun.write(pdf, bytes);
      // Read before any picture is made: rendering thousands of pages would take the server down.
      const pages = await pageCount(pdf);
      if (pages > MAX_PDF_PAGES) {
        throw new DocumentTooLong(`${pages} pages is more than the ${MAX_PDF_PAGES} the assistant reads at once.`);
      }
      // `-layout` keeps the columns of tables and forms; pages end with a form feed.
      await run(['pdftotext', '-layout', '-enc', 'UTF-8', pdf, join(folder, 'text.txt')]);
      await run(['pdftoppm', '-r', String(PAGE_DPI), '-jpeg', '-jpegopt', 'quality=80', pdf, join(folder, 'page')]);
      const texts = (await Bun.file(join(folder, 'text.txt')).text()).split('\f');
      // `page-1.jpg`, or `page-01.jpg` when there are 10 pages or more.
      const images = (await readdir(folder))
        .filter((name) => /^page-\d+\.jpg$/.test(name))
        .toSorted((a, b) => pageNumber(a) - pageNumber(b));
      return await Promise.all(
        images.map(async (name, index) => ({
          text: texts[index]?.trim() ?? '',
          image: await Bun.file(join(folder, name)).bytes(),
        })),
      );
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  }

  async readWord(bytes: Uint8Array): Promise<WordPiece[]> {
    const margins = await headersAndFooters(bytes);
    const images: { bytes: Uint8Array; mediaType: string }[] = [];
    const pictures = { size: 0 };
    let html: string;
    try {
      // HTML keeps the tables; each picture becomes a marker, cut out below.
      const result = await mammoth.convertToHtml(
        { buffer: Buffer.from(bytes) },
        {
          convertImage: mammoth.images.imgElement(async (image) => {
            const picture = new Uint8Array(await image.readAsArrayBuffer());
            pictures.size += picture.length;
            if (pictures.size > MAX_WORD_IMAGE_BYTES) throw new DocumentTooLong('Its pictures are too big to read.');
            images.push({ bytes: picture, mediaType: image.contentType });
            return { src: `open-agent-image:${images.length - 1}` };
          }),
        },
      );
      html = result.value;
    } catch (error) {
      if (error instanceof DocumentTooLong) throw error;
      throw new UnreadableDocument(String(error));
    }

    const pieces: WordPiece[] = margins.headers.map((text) => ({ type: 'text', text: `Header: ${text}` }));
    const marker = /<img[^>]*src="open-agent-image:(\d+)"[^>]*>/g;
    let start = 0;
    for (const match of html.matchAll(marker)) {
      pushText(pieces, html.slice(start, match.index));
      const image = images[Number(match[1])]!;
      if (VISIBLE_IMAGE_TYPES[image.mediaType]) pieces.push({ type: 'image', ...image });
      else pieces.push({ type: 'text', text: `[A picture in the ${image.mediaType} format, which cannot be shown.]` });
      start = match.index + match[0].length;
    }
    pushText(pieces, html.slice(start));
    for (const text of margins.footers) pieces.push({ type: 'text', text: `Footer: ${text}` });
    return pieces;
  }

  async readSpreadsheet(bytes: Uint8Array): Promise<string> {
    const expanded = await expandedSize(bytes);
    if (expanded > MAX_SPREADSHEET_BYTES) throw new DocumentTooLong('The spreadsheet is too big to read.');
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(bytes.slice().buffer);
    } catch (error) {
      throw new UnreadableDocument(String(error));
    }
    const sheets = workbook.worksheets.map((sheet) => {
      const rows: string[] = [];
      sheet.eachRow((row, number) => {
        const cells = Array.from({ length: row.cellCount }, (_, index) => cellText(row.getCell(index + 1).value));
        rows.push(`${number} | ${cells.join(' | ')}`);
      });
      return `Sheet "${sheet.name}":\n${rows.join('\n') || '(empty)'}`;
    });
    const text = sheets.join('\n\n');
    if (text.length > MAX_OUTPUT_CHARACTERS) throw new DocumentTooLong('The spreadsheet holds too much text.');
    return text;
  }
}

function pushText(pieces: WordPiece[], text: string): void {
  if (text.trim()) pieces.push({ type: 'text', text });
}

/** What a cell shows, with its formula when it has one: a formula written by a program has no result until Excel opens it. */
function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value !== 'object') return String(value);
  if ('richText' in value) return value.richText.map((run) => run.text).join('');
  if ('hyperlink' in value) return `${value.text} (${value.hyperlink})`;
  if ('error' in value) return value.error;
  const formula = 'formula' in value ? value.formula : value.sharedFormula;
  const result = value.result === undefined ? '' : ` → ${cellText(value.result as ExcelJS.CellValue)}`;
  return `=${formula}${result}`;
}

/** The size of a zip once expanded, from `unzip -l`'s last line, without expanding anything. */
async function expandedSize(bytes: Uint8Array): Promise<number> {
  const folder = await mkdtemp(join(tmpdir(), 'open-agent-xlsx-'));
  try {
    const xlsx = join(folder, 'sheet.xlsx');
    await Bun.write(xlsx, bytes);
    const total = /(\d+)\s+\d+ files?\s*$/.exec(await run(['unzip', '-l', xlsx]));
    if (!total) throw new UnreadableDocument('unzip did not give the size.');
    return Number(total[1]);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

/**
 * mammoth skips headers and footers, though they hold file numbers and addresses. A `.docx` is a zip: they are its
 * `word/header*.xml` and `word/footer*.xml`, read with `unzip` (in the image). Repeated ones (first page, even pages)
 * count once.
 */
async function headersAndFooters(bytes: Uint8Array): Promise<{ headers: string[]; footers: string[] }> {
  const folder = await mkdtemp(join(tmpdir(), 'open-agent-docx-'));
  try {
    const docx = join(folder, 'document.docx');
    await Bun.write(docx, bytes);
    const entries = (await run(['unzip', '-Z1', docx])).split('\n');
    const read = async (kind: 'header' | 'footer') => {
      const parts = entries.filter((entry) => new RegExp(`^word/${kind}\\d*\\.xml$`).test(entry)).toSorted();
      const texts = await Promise.all(parts.map(async (entry) => wordXmlText(await run(['unzip', '-p', docx, entry]))));
      return [...new Set(texts.filter(Boolean))];
    };
    return { headers: await read('header'), footers: await read('footer') };
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

/** The words of a WordprocessingML part, one paragraph per line. */
function wordXmlText(xml: string): string {
  return xml
    .replaceAll('</w:p>', '\n')
    .replaceAll('<w:tab/>', '\t')
    .replaceAll(/<[^>]+>/g, '')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&')
    .trim();
}

function pageNumber(name: string): number {
  return Number(/(\d+)/.exec(name)![1]);
}

/**
 * A broken or protected file makes the command exit with an error. Returns what it printed; a tool that runs too long
 * or prints too much is stopped and refused, so one upload cannot pin the server.
 */
async function run(command: string[]): Promise<string> {
  const process = Bun.spawn(command, { stdout: 'pipe', stderr: 'pipe' });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    process.kill();
  }, COMMAND_TIMEOUT_MS);
  try {
    const [output, failure, code] = await Promise.all([
      readCapped(process.stdout),
      new Response(process.stderr).text(),
      process.exited,
    ]);
    if (timedOut) throw new DocumentTooLong(`${command[0]} ran longer than ${COMMAND_TIMEOUT_MS / 1000} s.`);
    if (code !== 0) throw new UnreadableDocument(`${command[0]} failed: ${failure}`);
    return output;
  } catch (error) {
    // Stopped for printing too much: its pipe stays full, so the tool must be killed.
    process.kill();
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** Reads a tool's output, stopping past `MAX_OUTPUT_CHARACTERS`: a zip entry may expand without limit. */
async function readCapped(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = '';
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) return text;
    text += decoder.decode(chunk.value, { stream: true });
    if (text.length > MAX_OUTPUT_CHARACTERS) {
      throw new DocumentTooLong(`A tool printed more than ${MAX_OUTPUT_CHARACTERS} characters.`);
    }
  }
}

/** `pdfinfo` gives the page count without rendering anything. */
async function pageCount(pdf: string): Promise<number> {
  const pages = /^Pages:\s+(\d+)/m.exec(await run(['pdfinfo', pdf]));
  if (!pages) throw new UnreadableDocument('pdfinfo did not give the page count.');
  return Number(pages[1]);
}
