import { describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { UnreadableDocument } from '../../application/ports/document-reader.ts';
import { PopplerMammothReader } from './document-reader.ts';

const page = (contents: number) =>
  `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents ${contents} 0 R /Resources << /Font << /F1 7 0 R >> >> >>`;

function text(words: string): string {
  const stream = `BT /F1 18 Tf 20 100 Td (${words}) Tj ET`;
  return `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
}

/** A real two-page PDF, written by hand: Poppler rebuilds the missing cross-reference table. */
function twoPagePdf(): Uint8Array {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    page(5),
    page(6),
    text('Total: 42 EUR'),
    text('Signed in Nantes'),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const body = objects.map((object, index) => `${index + 1} 0 obj\n${object}\nendobj`).join('\n');
  return new TextEncoder().encode(`%PDF-1.4\n${body}\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n`);
}

describe('PopplerMammothReader.readPdf', () => {
  test('gives every page in order, with its text and its picture', async () => {
    const pages = await new PopplerMammothReader().readPdf(twoPagePdf());
    expect(pages.map(({ text: pageText }) => pageText)).toEqual(['Total: 42 EUR', 'Signed in Nantes']);
    for (const { image } of pages) expect([image[0], image[1]]).toEqual([0xff, 0xd8]);
  });

  test('refuses what is not a PDF', async () => {
    const reading = new PopplerMammothReader().readPdf(new TextEncoder().encode('not a pdf'));
    await expect(reading).rejects.toBeInstanceOf(UnreadableDocument);
  });
});

const WORD_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const paragraph = (words: string) => `<w:p><w:r><w:t>${words}</w:t></w:r></w:p>`;

/** A real `.docx`, zipped by hand: a body with a table, a header and a footer. */
function wordFile(): Uint8Array {
  const folder = mkdtempSync(join(tmpdir(), 'open-agent-docx-test-'));
  const files: Record<string, string> = {
    '[Content_Types].xml': `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    '_rels/.rels': `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    'word/document.xml': `<?xml version="1.0"?><w:document ${WORD_NS}><w:body>${paragraph('Fuite place n°37')}<w:tbl><w:tr><w:tc>${paragraph('Voisin')}</w:tc><w:tc>${paragraph('M. Garnier')}</w:tc></w:tr></w:tbl></w:body></w:document>`,
    'word/header1.xml': `<?xml version="1.0"?><w:hdr ${WORD_NS}>${paragraph('Dossier 4471 &amp; suite')}</w:hdr>`,
    'word/footer1.xml': `<?xml version="1.0"?><w:ftr ${WORD_NS}>${paragraph('Confidentiel')}</w:ftr>`,
  };
  try {
    for (const [name, content] of Object.entries(files)) {
      mkdirSync(join(folder, name, '..'), { recursive: true });
      writeFileSync(join(folder, name), content);
    }
    Bun.spawnSync(['zip', '-q', '-r', 'file.docx', ...Object.keys(files)], { cwd: folder });
    return new Uint8Array(readFileSync(join(folder, 'file.docx')));
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

describe('PopplerMammothReader.readWord', () => {
  test('reads the body with its tables, and the header and footer that mammoth skips', async () => {
    const pieces = await new PopplerMammothReader().readWord(wordFile());
    const texts = pieces.flatMap((piece) => (piece.type === 'text' ? [piece.text] : []));
    expect(texts[0]).toBe('Header: Dossier 4471 & suite');
    expect(texts.join('\n')).toContain('<td><p>M. Garnier</p></td>');
    expect(texts.at(-1)).toBe('Footer: Confidentiel');
  });
});
