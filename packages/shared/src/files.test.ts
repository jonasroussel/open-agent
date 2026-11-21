import { describe, expect, test } from 'bun:test';

import { DOCUMENT_ACCEPT, FILE_ACCEPT, fileKindOf, MEDIA_ACCEPT, mediaTypeOf } from './files.ts';

describe('fileKindOf', () => {
  test('reads the media type first, and the extension when the browser gives none', () => {
    expect(fileKindOf('photo.heic', 'image/jpeg')).toBe('image');
    expect(fileKindOf('notes.md', '')).toBe('text');
    expect(fileKindOf('budget.csv', 'application/octet-stream')).toBe('text');
    expect(fileKindOf('CV.DOCX', '')).toBe('word');
    expect(fileKindOf('message.webm', 'audio/webm;codecs=opus')).toBe('audio');
    expect(fileKindOf('clip.webm', '')).toBe('video');
    expect(fileKindOf('IMG_0042.MOV', 'video/quicktime')).toBe('video');
  });

  test('reads code and data files as text, whatever the browser calls them', () => {
    expect(fileKindOf('page.html', 'text/html')).toBe('text');
    expect(fileKindOf('data.json', 'application/json')).toBe('text');
    expect(fileKindOf('app.ts', 'video/mp2t')).toBe('text');
    expect(fileKindOf('script.py', 'text/x-python')).toBe('text');
  });

  test('refuses what the app cannot read, even under a known extension', () => {
    expect(fileKindOf('photo.heic', 'image/heic')).toBeNull();
    expect(fileKindOf('fake.pdf', 'application/x-msdownload')).toBeNull();
    expect(fileKindOf('drawing.svg', 'image/svg+xml')).toBeNull();
    expect(fileKindOf('old.doc', 'application/msword')).toBeNull();
    expect(fileKindOf('film.avi', 'video/x-msvideo')).toBeNull();
  });
});

describe('mediaTypeOf', () => {
  test('keeps a known media type and gives one to files that came without', () => {
    expect(mediaTypeOf('text', 'notes.md', 'text/markdown; charset=utf-8')).toBe('text/markdown');
    expect(mediaTypeOf('text', 'budget.csv', '')).toBe('text/csv');
    expect(mediaTypeOf('word', 'cv.docx', '')).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
  });

  test('serves pages and code as plain text, and one media type per format', () => {
    expect(mediaTypeOf('text', 'page.html', 'text/html')).toBe('text/plain');
    expect(mediaTypeOf('audio', 'note.m4a', 'audio/x-m4a')).toBe('audio/mp4');
    expect(mediaTypeOf('audio', 'note.mp3', '')).toBe('audio/mpeg');
  });
});

describe('accept lists', () => {
  test('keeps images and videos out of the documents, and together cover every file', () => {
    const documents = DOCUMENT_ACCEPT.split(',');
    expect(documents.some((entry) => entry.startsWith('image/') || entry.startsWith('video/'))).toBe(false);
    expect(documents.some((entry) => MEDIA_ACCEPT.split(',').includes(entry))).toBe(false);
    expect(new Set([...MEDIA_ACCEPT.split(','), ...documents])).toEqual(new Set(FILE_ACCEPT.split(',')));
  });
});
