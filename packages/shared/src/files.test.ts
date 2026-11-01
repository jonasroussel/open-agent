import { describe, expect, test } from 'bun:test';

import { fileKindOf, mediaTypeOf } from './files.ts';

describe('fileKindOf', () => {
  test('reads the media type first, and the extension when the browser gives none', () => {
    expect(fileKindOf('photo.heic', 'image/jpeg')).toBe('image');
    expect(fileKindOf('notes.md', '')).toBe('text');
    expect(fileKindOf('budget.csv', 'application/octet-stream')).toBe('text');
    expect(fileKindOf('CV.DOCX', '')).toBe('word');
  });

  test('refuses what the app cannot read, even under a known extension', () => {
    expect(fileKindOf('photo.heic', 'image/heic')).toBeNull();
    expect(fileKindOf('page.html', 'text/html')).toBeNull();
    expect(fileKindOf('fake.pdf', 'text/html')).toBeNull();
    expect(fileKindOf('drawing.svg', 'image/svg+xml')).toBeNull();
    expect(fileKindOf('old.doc', 'application/msword')).toBeNull();
  });
});

describe('mediaTypeOf', () => {
  test('keeps a known media type and gives one to files that came without', () => {
    expect(mediaTypeOf('text', 'notes.md', 'text/markdown; charset=utf-8')).toBe('text/markdown');
    expect(mediaTypeOf('text', 'budget.csv', '')).toBe('text/plain');
    expect(mediaTypeOf('word', 'cv.docx', '')).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
  });
});
