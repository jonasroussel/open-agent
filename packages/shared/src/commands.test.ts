import { describe, expect, test } from 'bun:test';

import { commandNameOf } from './commands.ts';

describe('commandNameOf', () => {
  test('takes a name as typed after the slash: lowercase, accents kept, spaces as dashes', () => {
    expect(commandNameOf('/Corriger')).toBe('corriger');
    expect(commandNameOf('  Résumer en 3 points ')).toBe('résumer-en-3-points');
    expect(commandNameOf('plus_court')).toBe('plus-court');
  });

  test('refuses what cannot follow a slash: empty, a digit first, symbols, too long', () => {
    expect(commandNameOf('/')).toBeNull();
    expect(commandNameOf('3-points')).toBeNull();
    expect(commandNameOf('corrige!')).toBeNull();
    expect(commandNameOf('a'.repeat(25))).toBeNull();
  });
});
