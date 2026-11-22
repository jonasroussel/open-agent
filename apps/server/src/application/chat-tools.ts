import {
  normalizeBindingKeys,
  validateSurface,
  type AskOutput,
  type DataModel,
  type ShowUiOutput,
} from '@open-agent/shared';
import type { DocumentToolOutput, WebSearchOutput } from '@open-agent/shared';
import { tool } from 'ai';
import { z } from 'zod';

import type { Artifact } from '../domain/artifact.ts';
import type { User } from '../domain/user.ts';
import type { Artifacts } from './artifacts.ts';
import { ToolRefusal } from './ports/context-services.ts';
import type { WebSearch } from './ports/web-search.ts';
import type { UsageRecorder } from './usage-recorder.ts';

/** Past two searches the model answers with what it has: a third one costs without helping. */
export const MAX_SEARCHES = 2;
/** What the model reads of each page found: enough to answer, few tokens. */
const RESULT_CHARACTERS = 1500;

/** What the model and the chat's card learn of a written document. */
function toolOutput(artifact: Artifact): DocumentToolOutput {
  return { id: artifact.id, kind: artifact.kind, title: artifact.title, version: artifact.version };
}

const CATALOG =
  'Components: a flat list, the first with id "root", each { "id", "component", ...props }, children named by id. Column { children: [ids] }; Row { children: [ids] }; Card { child: id }; Text { text (plain, **bold** only), variant?: "heading" | "body" | "caption" }; Badge { text }; Divider {}; Table { header: [strings], rows: [[strings]] }; Image { url: "/api/files/<id>", a file of the user only }; Checklist { items: [{ id, label }], checked: { "@path": "/checked" } }, an object item id → true; ChoiceChips { options: [{ value, label }], multiple?: boolean, value: { "@path": "/choice" } }, a string, or an array of strings when multiple. A { "@path": "/x" } is a JSON pointer into dataModel, which holds the starting values. At most 60 components.';

/** Checked by `execute` rather than the schema: the model gets every mistake as one error it can fix. */
const looseSurface = {
  components: z.array(z.looseObject({ id: z.string(), component: z.string() })),
  dataModel: z.record(z.string(), z.unknown()).optional(),
};

/** A small interface the user acts on; its state (what was ticked or chosen) is saved, and is its output. */
export const showUiTool = tool({
  description: `Show the user a small interactive interface in the answer. Use it only when the user has something to DO with the result: tick items (a shopping list, a packing list, steps to follow), choose between a few options, or compare a few items side by side. Never for a plain answer, never to decorate. Still write one short sentence of text with it. The output is the surface's current state: later in the conversation it tells what the user ticked or chose. ${CATALOG} Button { label, variant?: "primary" | "secondary", message }: tapping it sends "message" as the user's next message.`,
  inputSchema: z.object({ title: z.string().optional(), ...looseSurface }).transform(normalizeBindingKeys),
  execute: async (input): Promise<ShowUiOutput> => {
    const validation = validateSurface(input, 'show');
    if (!validation.ok) throw new ToolRefusal(`Invalid surface, nothing was shown:\n${validation.error}`);
    return { dataModel: (input.dataModel ?? {}) as DataModel };
  },
});

const ASK_DESCRIPTION = `Ask the user one question when the request cannot be answered without a choice only they can make. Draw the question as a small surface: the question as Text, and a few likely answers to tap, each a Button with its own event, or ChoiceChips with one send Button; a TextField when they may type their own. Your answer stops until they reply, then goes on: the output is { action: { name, context } }, the tapped event with its context's "@path" values filled in, or the name "reply" with { text } when they typed an answer instead. An action null means you may not ask again in this answer: decide yourself and say what you assumed. ${CATALOG} TextField { placeholder?, value: { "@path": "/answer" } }. Button { label, variant?: "primary" | "secondary", action: { event: { name, context?: { key: value or { "@path" } } } } }.`;

/** Checked here: without `execute`, a surface that cannot be drawn would stop the answer for nothing. */
const askInput = z
  .object(looseSurface)
  .transform(normalizeBindingKeys)
  .superRefine((input, context) => {
    const validation = validateSurface(input, 'ask');
    if (!validation.ok) context.addIssue({ code: 'custom', message: validation.error });
  });

/**
 * Without `execute`, a call ends the answer until the user replies. Once a question was asked in this answer, the
 * tool answers `null` itself: one round of questions per answer, the model then decides alone.
 */
export function askTool(alreadyAsked: boolean) {
  if (!alreadyAsked) return tool({ description: ASK_DESCRIPTION, inputSchema: askInput });
  return tool({
    description: ASK_DESCRIPTION,
    inputSchema: askInput,
    execute: async (): Promise<AskOutput> => ({ action: null }),
  });
}

/** A failed search reaches the model as an error: it answers without, and says so. */
export function searchTool(
  usage: UsageRecorder,
  user: User,
  conversationId: string,
  webSearch: WebSearch,
  abortSignal: AbortSignal,
  searches: { count: number },
) {
  return tool({
    description:
      'Search the web. Returns the most relevant pages, each with its title, link, an extract and its date when known.',
    inputSchema: z.object({
      query: z
        .string()
        .min(1)
        .max(300)
        .describe("What to type in a search engine, in the user's language, with the place when it matters."),
      recent: z.boolean().describe('True to keep only pages from the last few days: news, prices, events.'),
    }),
    execute: async ({ query, recent }): Promise<WebSearchOutput> => {
      // Asked for in parallel, past the limit: the refusal reaches the model, which answers with what it has.
      if (searches.count >= MAX_SEARCHES) {
        throw new ToolRefusal('No more searches this turn: answer with those pages.');
      }
      searches.count += 1;
      const found = await webSearch.search({ query, recent, locale: user.locale }, abortSignal);
      await usage.recordSearch(user, conversationId, found.provider);
      return {
        results: found.results.map((result) => ({ ...result, content: result.content.slice(0, RESULT_CHARACTERS) })),
      };
    },
  });
}

/** The canvas. A refused write (too long, unknown document) reaches the model as an error it can fix. */
export function documentTools(artifacts: Artifacts, user: User, conversationId: string) {
  return {
    create_document: tool({
      description:
        'Create a document in the canvas, a panel next to the conversation where the user reads it, edits it by hand, prints it or downloads it as Word or PDF.',
      inputSchema: z.object({
        kind: z
          .enum(['document', 'html'])
          .describe(
            '"document": Markdown text. "html": a complete page (<!doctype html>…) with its CSS and JavaScript inline and no outside files, shown live: games, cards, calculators.',
          ),
        title: z.string().min(1).max(120).describe("A short title, in the user's language."),
        content: z.string().min(1).describe('The whole content.'),
      }),
      execute: async (input) => toolOutput(await artifacts.create(user, conversationId, input)),
    }),
    update_document: tool({
      description:
        "Rewrite a document of the canvas with the requested changes, keeping everything else exactly as it is, the user's own edits included. Give its whole new content.",
      inputSchema: z.object({
        id: z.string().describe('The id of the document, from the list in the instructions.'),
        content: z.string().min(1).describe('The whole new content.'),
      }),
      execute: async ({ id, content }) => toolOutput(await artifacts.rewrite(conversationId, id, content)),
    }),
  };
}
