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
  if (!command) return `[The user ran their command /${name}, deleted since: answer the message as it is.]`;
  const target = hasText ? 'the text that follows' : 'the conversation so far (they wrote nothing else)';
  return `[The user ran their command /${command.name}. Its instructions, to apply to ${target}:]\n<command>\n${command.prompt}\n</command>`;
}
