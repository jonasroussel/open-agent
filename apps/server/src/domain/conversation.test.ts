import { describe, expect, test } from 'bun:test';

import { cleanSnippet } from './conversation.ts';

describe('cleanSnippet', () => {
  test('Markdown marks and line breaks become single spaces, around the found words', () => {
    const parts = [
      { text: '…repères :\n\n| Carburant | Prix |\n|---|---|\n| **', match: false },
      { text: 'Gazole', match: true },
      { text: '** | ≈ 2,35 €/L |', match: false },
    ];
    expect(cleanSnippet(parts)).toEqual([
      { text: '…repères : Carburant Prix ', match: false },
      { text: 'Gazole', match: true },
      { text: ' ≈ 2,35 €/L', match: false },
    ]);
  });

  test('the space between two found words stays', () => {
    const parts = [
      { text: 'Prénoms pour un ', match: false },
      { text: 'chat', match: true },
      { text: ' ', match: false },
      { text: 'roux', match: true },
      { text: ' :\n\n1. **Rouxquin**', match: false },
    ];
    expect(cleanSnippet(parts).map((part) => part.text)).toEqual([
      'Prénoms pour un ',
      'chat',
      ' ',
      'roux',
      ' : 1. Rouxquin',
    ]);
  });
});
