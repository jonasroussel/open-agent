import { describe, expect, test } from 'bun:test';

import { amendsLatest, cleanArtifactTitle } from './artifact.ts';

describe('amendsLatest', () => {
  const now = new Date('2026-11-01T10:00:00Z');

  test("the user's saves in one sitting change their own last version", () => {
    expect(amendsLatest({ author: 'user', createdAt: new Date('2026-11-01T09:52:00Z') }, now)).toBe(true);
  });

  test('a new sitting, or a version the model wrote, gets a new version', () => {
    expect(amendsLatest({ author: 'user', createdAt: new Date('2026-11-01T09:49:00Z') }, now)).toBe(false);
    expect(amendsLatest({ author: 'model', createdAt: new Date('2026-11-01T09:59:00Z') }, now)).toBe(false);
  });
});

describe('cleanArtifactTitle', () => {
  test('keeps one line without heading marks, never empty', () => {
    expect(cleanArtifactTitle('# Lettre de résiliation\nsuite')).toBe('Lettre de résiliation');
    expect(cleanArtifactTitle('  ')).toBe('Document');
  });
});
