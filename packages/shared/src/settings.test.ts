import { describe, expect, test } from 'bun:test';

import { missingCapabilities } from './settings.ts';

describe('missingCapabilities', () => {
  test('answers read text and pictures and use tools; everyday answers turn thinking off, thinking answers think', () => {
    expect(missingCapabilities('fast', ['text', 'image', 'tools', 'thinking_off'])).toEqual([]);
    expect(missingCapabilities('fast', ['text', 'tools', 'reasoning'])).toEqual(['image', 'thinking_off']);
    expect(missingCapabilities('reasoning', ['text', 'image', 'tools', 'thinking_off'])).toEqual(['reasoning']);
  });

  test('background calls need structured JSON with thinking off, but no pictures', () => {
    expect(missingCapabilities('background', ['text', 'structured_outputs', 'thinking_off'])).toEqual([]);
    expect(missingCapabilities('background', ['text', 'structured_outputs', 'reasoning'])).toEqual(['thinking_off']);
  });

  test('the image model reads words and photos and draws', () => {
    expect(missingCapabilities('image', ['text', 'image', 'image_output'])).toEqual([]);
    expect(missingCapabilities('image', ['text', 'image', 'tools'])).toEqual(['image_output']);
  });
});
