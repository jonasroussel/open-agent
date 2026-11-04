/** A request the user saved to run again with `/name`: its prompt applies to what they write after it. */
export const MAX_COMMAND_NAME_LENGTH = 24;
export const MAX_COMMAND_PROMPT_LENGTH = 4_000;
export const MAX_COMMANDS = 50;

/** Lowercase letters (accents too), digits and dashes, from a letter: what the user types after `/`. */
const COMMAND_NAME = /^\p{Ll}[\p{Ll}\p{N}-]*$/u;

/**
 * The name as typed after `/`, or `null` when it cannot be one: "/Corriger mon texte" gives "corriger-mon-texte".
 * The server and the client share it, so a name accepted here is accepted there.
 */
export function commandNameOf(raw: string): string | null {
  const name = raw
    .trim()
    .replace(/^\/+/, '')
    .toLowerCase()
    .replaceAll(/[\s_]+/g, '-')
    .replaceAll(/-+/g, '-')
    .replace(/-$/, '');
  return name.length <= MAX_COMMAND_NAME_LENGTH && COMMAND_NAME.test(name) ? name : null;
}
