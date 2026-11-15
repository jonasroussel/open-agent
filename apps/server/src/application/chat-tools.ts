import type { AskUserOutput, DocumentToolOutput, WebSearchOutput } from '@open-agent/shared';
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

const askInput = z.object({ question: z.string(), options: z.array(z.string()) });
const ASK_DESCRIPTION =
  'Ask the user one question when you cannot go on without a choice only they can make. Offer 2 to 4 short answers they can tap, or [] when none can be guessed; they may also type their own. Your answer stops until they reply, then goes on. An answer null means you may not ask again in this answer: decide yourself and say what you assumed.';

/**
 * Without `execute`, a call ends the answer until the user replies. Once a question was asked in this answer, the
 * tool answers `null` itself: one round of questions per answer, the model then decides alone.
 */
export function askTool(alreadyAsked: boolean) {
  if (!alreadyAsked) return tool({ description: ASK_DESCRIPTION, inputSchema: askInput });
  return tool({
    description: ASK_DESCRIPTION,
    inputSchema: askInput,
    execute: async (): Promise<AskUserOutput> => ({ answer: null }),
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
