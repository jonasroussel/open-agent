import type { Artifact } from '../domain/artifact.ts';
import { parseDay, plusDays } from '../domain/calendar.ts';
import type { ChatMessage } from '../domain/conversation.ts';
import type { MemoryRule } from '../domain/memory.ts';
import { nameOf } from '../domain/user.ts';
import type { User } from '../domain/user.ts';

/**
 * The model answers the clearer request; the conversation keeps the user's own words. Files stay attached. After an
 * answered question, the request is the user message before it.
 */
export function withLatestRequest(messages: ChatMessage[], rewrittenRequest: string): ChatMessage[] {
  const latestIndex = messages.findLastIndex((message) => message.role === 'user');
  return messages.map((message, index) =>
    index === latestIndex
      ? {
          ...message,
          parts: [
            { type: 'text' as const, text: rewrittenRequest },
            ...message.parts.filter((part) => part.type !== 'text'),
          ],
        }
      : message,
  );
}

/**
 * The date and time, at the start of the user's latest message for the model only: there, it changes nothing before
 * it, so the provider's cache of the instructions and the history stays valid from one message to the next. Tomorrow
 * is named too: answering short, the fast model dated « lundi » wrong one time in three from today alone (2026-11-15).
 */
export function timeNote(now: Date): string {
  const time = new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Paris',
  }).format(now);
  // The calendar day in Paris, then the next one, counted in UTC: a clock change never skips or repeats a day.
  const today = parseDay(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(now))!;
  const tomorrow = new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(plusDays(today, 1));
  return `[Maintenant : ${time}, heure de Paris. Demain : ${tomorrow}.]`;
}

/**
 * Beside the time, right before the user's words: the model (DeepSeek) writes its thoughts in English by habit, and
 * they are shown. The same line in the instructions alone left one answer in five thinking in English (2026-11-15).
 */
export const THOUGHTS_NOTE = '[Écris ta réflexion dans la langue de ce message, comme ta réponse.]';

/**
 * A document the user brought back to an older version is said in their latest message: in the instructions alone,
 * the model redid the undone changes it saw asked and confirmed earlier in the history (2026-11-03).
 */
export function restoreNotes(documents: readonly { artifact: Artifact; restoredFrom: number | null }[]): string[] {
  return documents.flatMap(({ artifact, restoredFrom }) =>
    restoredFrom
      ? [
          `[Canevas : j'ai ramené « ${artifact.title} » à la version ${restoredFrom}, volontairement. Les modifications faites après cette version, plus haut dans cette conversation, sont annulées : ne les refais pas, sauf si je le redemande.]`,
        ]
      : [],
  );
}

/** Notes for the model only, opening the user's latest message: the conversation keeps the user's own words. */
export function withNotes(messages: ChatMessage[], notes: readonly string[]): ChatMessage[] {
  const latestIndex = messages.findLastIndex((message) => message.role === 'user');
  return messages.map((message, index) =>
    index === latestIndex
      ? { ...message, parts: [{ type: 'text' as const, text: notes.join('\n') }, ...message.parts] }
      : message,
  );
}

/**
 * Past versions written by the tools stay out of the model's history: the instructions hold the latest one of each
 * document, so a long document is not paid for again at every version. Their content is dropped, not replaced: a
 * placeholder sentence there was copied by the model as a new version's whole content (2026-11-02).
 */
export function withoutDocumentBodies(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((message) => ({
    ...message,
    parts: message.parts.map((part) =>
      (part.type === 'tool-create_document' || part.type === 'tool-update_document') && part.input
        ? ({
            ...part,
            input: Object.fromEntries(Object.entries(part.input).filter(([key]) => key !== 'content')),
          } as typeof part)
        : part,
    ),
  }));
}

const READ_EARLIER =
  "Fichier lu dans une réponse précédente : son contenu n'est plus joint. Relis-le avec le même outil si la question porte sur lui.";

/**
 * A file downloaded or read again by a tool served the answer that read it: its content was never saved, so an older
 * call's result says so, in French as everything the code adds for the model.
 */
export function withEarlierReadNotes(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((message) => ({
    ...message,
    parts: message.parts.map((part) => {
      if (
        (part.type !== 'tool-download_file' && part.type !== 'tool-read_attachment') ||
        part.state !== 'output-available'
      ) {
        return part;
      }
      const output: Record<string, unknown> = { ...part.output, note: READ_EARLIER };
      return { ...part, output } as unknown as typeof part;
    }),
  }));
}

/**
 * The admin's assistant prompt (`DEFAULT_PROMPTS.assistant` until changed), then what only the code knows: the date,
 * the app's language, whether the web can be searched, the canvas documents and the user's rules. The rules come
 * last, so they win over the general style.
 */
export function instructions(
  prompt: string,
  user: User,
  rules: readonly MemoryRule[],
  now: Date,
  canSearch: boolean,
  documents: readonly { artifact: Artifact; content: string; restoredFrom: number | null }[],
  commandNames: readonly string[],
  /** In a shared conversation, everyone in it, the owner first; `null` otherwise. */
  people: readonly string[] | null,
): string {
  const today = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'full', timeZone: 'Europe/Paris' }).format(now);
  return [
    prompt,
    '',
    `Nous sommes le ${today}. L'application de l'utilisateur est en ${user.locale === 'fr' ? 'français' : 'anglais'}.`,
    ...(canSearch
      ? []
      : ["La recherche web est indisponible pour le moment : dis-le quand une réponse a besoin de faits d'actualité."]),
    ...(documents.length > 0
      ? [
          '',
          "Documents du canevas de cette conversation, dans leur dernière version (l'utilisateur a pu les modifier à la main) :",
          ...documents.map(
            ({ artifact, content, restoredFrom }) =>
              `<document id="${artifact.id}" kind="${artifact.kind}" title="${artifact.title.replaceAll('"', "'")}" version="${artifact.version}"${restoredFrom ? ` restored-from="${restoredFrom}"` : ''}>\n${content}\n</document>`,
          ),
          ...documents.flatMap(({ artifact, restoredFrom }) =>
            restoredFrom
              ? [
                  `L'utilisateur a ramené « ${artifact.title} » à la version ${restoredFrom}, volontairement : les modifications faites après elle, les tiennes comprises, sont annulées. Travaille à partir de ce contenu, ne refais jamais ces modifications sauf s'il le demande, et ne décris pas le document tel qu'il était avant.`,
                ]
              : [],
          ),
        ]
      : []),
    ...(rules.length > 0
      ? [
          '',
          "Ce que tu retiens de l'utilisateur, d'après ce qu'il a dit : des préférences à suivre sauf si son dernier message demande autre chose, et des faits le concernant, à utiliser quand ils comptent :",
          ...rules.map((rule) => `- ${rule.text}`),
        ]
      : []),
    ...(commandNames.length > 0
      ? [
          '',
          `Les commandes de l'utilisateur, à réécrire avec save_command quand il le demande : ${commandNames.map((name) => `/${name}`).join(', ')}.`,
        ]
      : []),
    ...(people
      ? [
          '',
          `Cette conversation est partagée entre ${people.join(', ')} : chaque message d'utilisateur s'ouvre sur le nom de son auteur entre crochets. Tu réponds au dernier, ${nameOf(user)} : « l'utilisateur », ci-dessus et ci-dessous, c'est lui, et ce que tu retiens ne concerne que lui. Appelle chacun par ce nom quand c'est utile. Ici, tu ne peux lire ni ses autres conversations ni sa bibliothèque de fichiers : pour un de ses fichiers, dis-lui de le joindre à son message.`,
        ]
      : []),
  ].join('\n');
}
