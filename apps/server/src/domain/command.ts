/** A request the user saved to run again with `/name`. */
export type Command = {
  id: string;
  userId: number;
  name: string;
  prompt: string;
  /** How many messages ran it. */
  uses: number;
  /** Where the user put it: the smallest first. */
  position: number;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * What the model reads before a message that runs a command: the command's prompt, to apply to the user's text after
 * it, or to the conversation when they wrote nothing. A command deleted since is said so: its message stays readable.
 */
export function commandNote(name: string, command: Command | null, hasText: boolean): string {
  if (!command) {
    return `[L'utilisateur a lancé sa commande /${name}, supprimée depuis : réponds au message tel qu'il est.]`;
  }
  const target = hasText ? 'au texte qui suit' : "à la conversation jusqu'ici (il n'a rien écrit d'autre)";
  return `[L'utilisateur a lancé sa commande /${command.name}. Ses instructions, à appliquer ${target} :]\n<command>\n${command.prompt}\n</command>`;
}
