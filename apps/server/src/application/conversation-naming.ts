import { generateText, NoObjectGeneratedError, Output } from 'ai';
import { z } from 'zod';

import type { ConversationRepository } from '../domain/conversation-repository.ts';
import { cleanIcon, cleanTitle } from '../domain/conversation.ts';
import type { ChatMessage, Conversation } from '../domain/conversation.ts';
import { attachedNames } from '../domain/library-file.ts';
import type { User } from '../domain/user.ts';
import type { Models } from './models.ts';
import type { Participants } from './participants.ts';
import { textOf } from './pre-analysis.ts';
import type { UsageRecorder } from './usage-recorder.ts';

/** A new conversation's title and icon, named from its first message beside the answer. */
export class ConversationNaming {
  readonly #conversations: ConversationRepository;
  readonly #participants: Participants;
  readonly #models: Models;
  readonly #usage: UsageRecorder;

  constructor(conversations: ConversationRepository, participants: Participants, models: Models, usage: UsageRecorder) {
    this.#conversations = conversations;
    this.#participants = participants;
    this.#models = models;
    this.#usage = usage;
  }

  /**
   * A title and an icon, from the first message. Never fails the turn: without them the sidebar shows "New
   * conversation" and the default icon.
   */
  async name(user: User, conversation: Conversation, first: ChatMessage): Promise<void> {
    // A first message may be only a photo or a document: its name is enough to name the conversation.
    const text = textOf(first) || attachedNames(first);
    if (!text) return;
    const choice = await this.#models.choose('background', user);
    try {
      const result = await generateText({
        model: choice.model,
        output: Output.object({ schema: z.object({ language: z.string(), title: z.string(), icon: z.string() }) }),
        prompt: `Nomme une conversation qui commence par le message ci-dessous. Réponds uniquement en JSON : {"language", "title", "icon"}.\n- language : la langue dans laquelle l'utilisateur écrit le message. Une langue dont il parle, qu'il cite ou vers laquelle il veut une traduction n'est que le sujet. Quand le message est trop court pour le dire, ${user.locale === 'fr' ? 'le français' : "l'anglais"}.\n- title : un titre court (6 mots au plus), dans cette langue, sans guillemets.\n- icon : le nom d'une icône Lucide (lucide.dev, kebab-case, par exemple "fuel", "utensils", "file-text") qui montre le mieux le sujet.\n\nMessage :\n${text.slice(0, 2000)}`,
        maxOutputTokens: 80,
      });
      await this.#usage.record(user, conversation.id, 'title', choice, result.usage, result.providerMetadata);
      const title = cleanTitle(result.output.title);
      // A malformed name gets the default icon, so the next messages do not ask again.
      const icon = cleanIcon(result.output.icon) ?? 'message-square';
      if (title && !conversation.title) await this.#conversations.rename(conversation.id, title);
      await this.#conversations.setIcon(conversation.id, icon);
      await this.#participants.publish(conversation, { type: 'conversations' });
    } catch (error) {
      // A name that did not parse was billed all the same: the quota must see it.
      if (NoObjectGeneratedError.isInstance(error)) {
        await this.#usage.record(user, conversation.id, 'title', choice, error.usage, undefined, error.response?.body);
      }
      console.error('Naming a conversation failed:', error);
    }
  }
}
