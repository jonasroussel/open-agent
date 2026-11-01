import { describe, expect, test } from 'bun:test';

import { cleanFileName, estimatedTokens } from './library-file.ts';

describe('cleanFileName', () => {
  test('keeps only the name, without folders nor control characters', () => {
    expect(cleanFileName('C:\\Users\\ana\\Documents\\CV 2026.pdf')).toBe('CV 2026.pdf');
    expect(cleanFileName('../../etc/passwd')).toBe('passwd');
    expect(cleanFileName('lettre\n\u0000.docx')).toBe('lettre.docx');
    expect(cleanFileName('  ')).toBe('file');
  });
});

describe('estimatedTokens', () => {
  test('counts the text and every picture', () => {
    expect(
      estimatedTokens([
        { type: 'text', text: 'a'.repeat(3000) },
        { type: 'image', name: 'page-1.jpg', mediaType: 'image/jpeg' },
      ]),
    ).toBe(2000);
  });
});
