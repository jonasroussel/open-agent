import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import mammoth from 'mammoth';

import {
  UnreadableDocument,
  type DocumentReader,
  type PdfPage,
  type WordPiece,
} from '../../application/ports/document-reader.ts';

/** Enough to read small print on an A4 page, at a few hundred tokens per picture. */
const PAGE_DPI = 110;
/** Word may embed EMF or WMF drawings, which the model cannot see. */
const VISIBLE_IMAGE_TYPES: Record<string, true> = {
  'image/png': true,
  'image/jpeg': true,
  'image/gif': true,
  'image/webp': true,
};
/** PDFs with Poppler (`pdftotext`, `pdftoppm`; `poppler-utils` in the image), Word files with mammoth. */
export class PopplerMammothReader implements DocumentReader {
  async readPdf(bytes: Uint8Array): Promise<PdfPage[]> {
    const folder = await mkdtemp(join(tmpdir(), 'open-agent-pdf-'));
    try {
      const pdf = join(folder, 'document.pdf');
      await Bun.write(pdf, bytes);
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
    let html: string;
    try {
      // HTML keeps the tables; each picture becomes a marker, cut out below.
      const result = await mammoth.convertToHtml(
        { buffer: Buffer.from(bytes) },
        {
          convertImage: mammoth.images.imgElement(async (image) => {
            images.push({ bytes: new Uint8Array(await image.readAsArrayBuffer()), mediaType: image.contentType });
            return { src: `open-agent-image:${images.length - 1}` };
          }),
        },
      );
      html = result.value;
    } catch (error) {
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
}

function pushText(pieces: WordPiece[], text: string): void {
  if (text.trim()) pieces.push({ type: 'text', text });
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

/** A broken or protected file makes the command exit with an error. Returns what it printed. */
async function run(command: string[]): Promise<string> {
  const process = Bun.spawn(command, { stdout: 'pipe', stderr: 'pipe' });
  const [output, failure, code] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  if (code !== 0) throw new UnreadableDocument(`${command[0]} failed: ${failure}`);
  return output;
}
