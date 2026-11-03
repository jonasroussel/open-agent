import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import ExcelJS from 'exceljs';

import { CannotMake } from '../../application/ports/file-maker.ts';
import { OfficeFileMaker } from './office-file-maker.ts';

const maker = new OfficeFileMaker();
const PNG_START = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
const PIXEL = new Uint8Array(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ),
);

/** The text of a PDF, as Poppler reads it. */
function pdfText(pdf: Uint8Array): string {
  const folder = mkdtempSync(join(tmpdir(), 'open-agent-made-'));
  try {
    writeFileSync(join(folder, 'made.pdf'), pdf);
    return Bun.spawnSync(['pdftotext', '-layout', join(folder, 'made.pdf'), '-']).stdout.toString();
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

describe('OfficeFileMaker.spreadsheet', () => {
  test('keeps formulas live, real dates and amounts formatted, and sheet names Excel accepts', async () => {
    const bytes = await maker.spreadsheet([
      {
        name: 'Budget: été/hiver',
        columns: [{ header: 'Poste' }, { header: 'Montant', format: 'euro' }, { header: 'Le', format: 'date' }],
        rows: [
          ['Loyer', 750, '2026-11-05'],
          ['Total', '=SUM(B2:B2)', null],
        ],
      },
      { name: 'budget: été/hiver', columns: [{ header: 'Note' }], rows: [['= pas une formule ?']] },
    ]);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes.slice().buffer);

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(['Budget  été hiver', 'budget  été hiver (2)']);
    const sheet = workbook.worksheets[0]!;
    expect(sheet.getCell('A1').value).toBe('Poste');
    expect(sheet.getCell('B3').value).toEqual({ formula: 'SUM(B2:B2)' });
    expect(sheet.getCell('C2').value).toEqual(new Date('2026-11-05T00:00:00Z'));
    expect(sheet.getCell('C2').numFmt).toBe('dd/mm/yyyy');
    expect(sheet.getCell('B2').numFmt).toBe('#,##0.00 "€"');
  });
});

describe('OfficeFileMaker.pdf', () => {
  test('lays out the Markdown as text, with its accents and symbols as written, and the pictures given', async () => {
    const pdf = await maker.pdf(
      '# Attestation\n\nJe soussignée **Marie Dupont**, R&D <chez> « Vivaldi ».\n\n- Premier point\n- Second point\n\n| Date | Montant |\n| --- | --- |\n| 05/11 | 750 € |\n\n![Signature](sig)',
      new Map([['sig', { bytes: PIXEL, mediaType: 'image/png' }]]),
      false,
    );
    const text = pdfText(pdf);
    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe('%PDF-');
    for (const expected of [
      'Attestation',
      'Marie Dupont, R&D <chez> « Vivaldi ».',
      'Premier point',
      '750 €',
      'Signature',
    ]) {
      expect(text).toContain(expected);
    }
  });

  test('refuses a picture it was not given', async () => {
    const making = maker.pdf('![Logo](https://example.com/logo.png)', new Map(), false);
    await expect(making).rejects.toBeInstanceOf(CannotMake);
  });
});

describe('OfficeFileMaker.chart', () => {
  const bars = {
    data: { values: [{ poste: 'Loyer', montant: 750 }] },
    mark: 'bar',
    encoding: { x: { field: 'poste', type: 'nominal' }, y: { field: 'montant', type: 'quantitative' } },
  };

  test('draws a Vega-Lite chart as a PNG', async () => {
    expect((await maker.chart(bars)).slice(0, 4)).toEqual(PNG_START);
  });

  test('loads nothing: a URL anywhere in the spec is refused', async () => {
    const lookup = {
      ...bars,
      transform: [{ lookup: 'poste', from: { data: { url: 'file:///etc/passwd' }, key: 'id', fields: ['x'] } }],
    };
    await expect(maker.chart(lookup)).rejects.toThrow('never from a URL');
  });

  test("runs no code from the spec's expressions", async () => {
    const escape = { ...bars, transform: [{ calculate: "constructor.constructor('return process')()", as: 'x' }] };
    await expect(maker.chart(escape)).rejects.toBeInstanceOf(CannotMake);
  });
});

describe('OfficeFileMaker.qrCode', () => {
  test('makes a PNG, and refuses a text too long for a QR code', async () => {
    expect((await maker.qrCode('WIFI:T:WPA;S:Maison;P:secret;;')).slice(0, 4)).toEqual(PNG_START);
    await expect(maker.qrCode('x'.repeat(5_000))).rejects.toBeInstanceOf(CannotMake);
  });
});
