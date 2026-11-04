import { commandNameOf, MAX_COMMAND_PROMPT_LENGTH, MAX_COMMANDS, type SaveCommandOutput } from '@open-agent/shared';
import { tool } from 'ai';
import { z } from 'zod';

import type { CommandRepository } from '../domain/command-repository.ts';
import { commandNote, type Command } from '../domain/command.ts';
import type { ChatMessage } from '../domain/conversation.ts';
import type { User } from '../domain/user.ts';
import type { ChangeFeed } from './ports/change-feed.ts';
import type { Clock } from './ports/clock.ts';
import { ToolRefusal } from './ports/context-services.ts';

export type CommandResult =
  | { ok: true; command: Command }
  | { ok: false; reason: 'invalid_request' | 'not_found' | 'command_name_taken' | 'commands_full' };

type Valid = { ok: true; name: string; prompt: string } | { ok: false; reason: 'invalid_request' };

function validated(name: unknown, prompt: unknown): Valid {
  const cleanName = typeof name === 'string' ? commandNameOf(name) : null;
  const cleanPrompt = typeof prompt === 'string' ? prompt.trim() : '';
  if (!cleanName || !cleanPrompt || cleanPrompt.length > MAX_COMMAND_PROMPT_LENGTH) {
    return { ok: false, reason: 'invalid_request' };
  }
  return { ok: true, name: cleanName, prompt: cleanPrompt };
}

/** The command a user message runs, as the client sends it: its id and the name its badge shows. */
function commandOf(message: ChatMessage): { id: string; name: string } | null {
  const command = message.role === 'user' ? message.metadata?.command : undefined;
  return typeof command?.id === 'string' && typeof command.name === 'string' ? command : null;
}

/**
 * A user's commands: requests saved to run again with `/name`. The message keeps the user's words and a badge; the
 * model gets the command's prompt before them, the current one, read again at every answer.
 */
export class Commands {
  readonly #commands: CommandRepository;
  readonly #clock: Clock;
  readonly #changes: ChangeFeed;

  constructor(commands: CommandRepository, clock: Clock, changes: ChangeFeed) {
    this.#commands = commands;
    this.#clock = clock;
    this.#changes = changes;
  }

  list(user: User): Promise<Command[]> {
    return this.#commands.listOf(user.id);
  }

  async add(user: User, name: unknown, prompt: unknown): Promise<CommandResult> {
    const valid = validated(name, prompt);
    if (!valid.ok) return valid;
    if (await this.#commands.findByName(user.id, valid.name)) return { ok: false, reason: 'command_name_taken' };
    if ((await this.#commands.listOf(user.id)).length >= MAX_COMMANDS) return { ok: false, reason: 'commands_full' };
    const now = this.#clock.now();
    const command: Command = {
      id: crypto.randomUUID(),
      userId: user.id,
      name: valid.name,
      prompt: valid.prompt,
      uses: 0,
      createdAt: now,
      updatedAt: now,
    };
    await this.#commands.create(command);
    this.#changes.publish(user.id, { type: 'commands' });
    return { ok: true, command };
  }

  async update(user: User, id: string, name: unknown, prompt: unknown): Promise<CommandResult> {
    const valid = validated(name, prompt);
    if (!valid.ok) return valid;
    const command = await this.#commands.find(user.id, id);
    if (!command) return { ok: false, reason: 'not_found' };
    const named = await this.#commands.findByName(user.id, valid.name);
    if (named && named.id !== id) return { ok: false, reason: 'command_name_taken' };
    const now = this.#clock.now();
    await this.#commands.update(id, valid.name, valid.prompt, now);
    this.#changes.publish(user.id, { type: 'commands' });
    return { ok: true, command: { ...command, name: valid.name, prompt: valid.prompt, updatedAt: now } };
  }

  async delete(user: User, id: string): Promise<boolean> {
    if (!(await this.#commands.find(user.id, id))) return false;
    await this.#commands.delete(id);
    this.#changes.publish(user.id, { type: 'commands' });
    return true;
  }

  /**
   * Every message that runs a command gets the command's prompt before its words, for the model and the pre-analysis.
   * The messages kept in the conversation stay as the user sent them.
   */
  async expand(user: User, messages: readonly ChatMessage[]): Promise<ChatMessage[]> {
    const commands = new Map((await this.#commands.listOf(user.id)).map((command) => [command.id, command]));
    return messages.map((message) => {
      const ran = commandOf(message);
      if (!ran) return message;
      const hasText = message.parts.some((part) => part.type === 'text' && part.text.trim());
      const text = commandNote(ran.name, commands.get(ran.id) ?? null, hasText);
      return { ...message, parts: [{ type: 'text', text }, ...message.parts] };
    });
  }

  /** Counted once per message sent, so the composer offers the most used first. */
  async recordUse(user: User, message: ChatMessage): Promise<void> {
    const ran = commandOf(message);
    const command = ran && (await this.#commands.find(user.id, ran.id));
    if (!command) return;
    await this.#commands.recordUse(command.id);
    this.#changes.publish(user.id, { type: 'commands' });
  }

  /** The names the model may update with `save_command`. */
  async names(user: User): Promise<string[]> {
    return (await this.#commands.listOf(user.id)).map((command) => command.name);
  }

  /** The model makes a command from the user's request, or rewrites one of theirs by its name. */
  toolFor(user: User) {
    return tool({
      description:
        "Save a command the user asks for (« fais-moi une commande… », « crée un raccourci pour… »), or rewrite one of theirs by its name. They then run it with /name or its button in the message field, next to the paperclip: its prompt applies to the text they write after it. Write the prompt in the user's language, as clear standing instructions that work on any text they give (« Corrige les fautes d'orthographe et de grammaire du texte, sans changer le style. Donne seulement le texte corrigé. »). Pick a short name, one or two words, lowercase.",
      inputSchema: z.object({
        name: z.string().describe('As typed after the slash: "corriger", "resume-court".'),
        prompt: z.string().max(MAX_COMMAND_PROMPT_LENGTH),
      }),
      execute: async ({ name, prompt }): Promise<SaveCommandOutput> => {
        const existing = await this.#commands.findByName(user.id, commandNameOf(name) ?? '');
        const result = existing
          ? await this.update(user, existing.id, name, prompt)
          : await this.add(user, name, prompt);
        if (!result.ok) {
          const reasons = {
            invalid_request:
              'A name is lowercase letters, digits and dashes, from a letter, 24 at most; the prompt is needed.',
            commands_full: `The user has ${MAX_COMMANDS} commands already: they must delete one in « Mes commandes » first.`,
            command_name_taken: 'Another command has this name: pick another one.',
            not_found: 'This command no longer exists.',
          };
          throw new ToolRefusal(reasons[result.reason]);
        }
        return { id: result.command.id, name: result.command.name, created: !existing };
      },
    });
  }
}
