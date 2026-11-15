import { describe, expect, test } from 'bun:test';

import { amendsLatest, cleanArtifactTitle } from './artifact.ts';

describe('amendsLatest', () => {
  const now = new Date('2026-11-01T10:00:00Z');

  test("the user's saves in one sitting change their own last version", () => {
    expect(amendsLatest({ userId: 1, createdAt: new Date('2026-11-01T09:52:00Z') }, 1, now)).toBe(true);
  });

  test("a new sitting, another member's version, the model's, or one whose writer is unknown gets a new version", () => {
    expect(amendsLatest({ userId: 1, createdAt: new Date('2026-11-01T09:49:00Z') }, 1, now)).toBe(false);
    expect(amendsLatest({ userId: 2, createdAt: new Date('2026-11-01T09:59:00Z') }, 1, now)).toBe(false);
    expect(amendsLatest({ userId: null, createdAt: new Date('2026-11-01T09:59:00Z') }, 1, now)).toBe(false);
  });
});

describe('cleanArtifactTitle', () => {
  test('keeps one line without heading marks, never empty', () => {
    expect(cleanArtifactTitle('# Lettre de résiliation\nsuite')).toBe('Lettre de résiliation');
    expect(cleanArtifactTitle('  ')).toBe('Document');
  });
});
