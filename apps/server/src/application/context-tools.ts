import type {
  CalculateOutput,
  DatePlusDaysOutput,
  DaysBetweenOutput,
  DownloadFileOutput,
  ListFilesOutput,
  ModelCapability,
  ReadConversationOutput,
  ReadAttachmentOutput,
  ReadFileOutput,
  ReadWebPageOutput,
  SearchConversationsOutput,
  WeatherOutput,
} from '@open-agent/shared';
import { tool, type ModelMessage, type ToolResultPart } from 'ai';
import { z } from 'zod';

import { daysBetween, formatDay, parseDay, plusDays, weekdayOf } from '../domain/calendar.ts';
import type { ConversationRepository } from '../domain/conversation-repository.ts';
import { cleanSnippet, isOutsideHistory, searchTerms } from '../domain/conversation.ts';
import { attachedNames, estimatedTokens } from '../domain/library-file.ts';
import type { User } from '../domain/user.ts';
import type { Library, ModelPiece } from './library.ts';
import type { Participants } from './participants.ts';
import {
  ToolRefusal,
  type Calculator,
  type FileDownloader,
  type WeatherService,
  type WebPageReader,
} from './ports/context-services.ts';
import { textOf } from './pre-analysis.ts';

/**
 * Calls of each tool in one answer. Each call sends the whole conversation to the model again: past these, the model
 * answers with what it has.
 */
export const CONTEXT_TOOL_CAPS = {
  search_conversations: 2,
  read_conversation: 2,
  list_files: 1,
  read_file: 2,
  read_web_page: 3,
  download_file: 3,
  read_attachment: 3,
  weather: 2,
  calculate: 5,
  days_between: 3,
  date_plus_days: 3,
} as const;

type ContextToolName = keyof typeof CONTEXT_TOOL_CAPS;

const FOUND_CONVERSATIONS = 8;
const LISTED_FILES = 30;
/** About 65,000 tokens each: a long conversation or page whole, a small part of the model's million. */
const CONVERSATION_CHARACTERS = 200_000;
const PAGE_CHARACTERS = 200_000;

/** Why a downloaded file could not be read, for the model. */
const DOWNLOAD_REFUSALS = {
  file_too_large: 'The file is too big to read.',
  file_type_unsupported: 'This kind of file cannot be read.',
  file_unreadable: 'The file is broken or protected: it cannot be read.',
  file_too_long: 'The file is too long to read whole.',
} as const;
/** A longer file is refused rather than read in part: attached, the model reads all of it. */
const READ_FILE_TOKENS = 50_000;

/** What the model reads of a file tool's result: what is saved, and where the file's content is. */
function toModelOutput({ output }: { output: unknown }): ToolResultPart['output'] {
  return {
    type: 'content',
    value: [
      { type: 'text', text: JSON.stringify(output) },
      { type: 'text', text: 'Son contenu suit, dans le dernier message, pour cette réponse seulement.' },
    ],
  };
}

/**
 * What the model may look up before answering: the user's other conversations and files, a page or a file at a link,
 * the weather, and exact calculations. Everything is the user's own or public; nothing here writes.
 */
export class ContextTools {
  readonly #conversations: ConversationRepository;
  readonly #participants: Participants;
  readonly #library: Library;
  readonly #calculator: Calculator;
  readonly #pages: WebPageReader;
  readonly #weather: WeatherService;
  readonly #downloads: FileDownloader;

  constructor(
    conversations: ConversationRepository,
    participants: Participants,
    library: Library,
    calculator: Calculator,
    pages: WebPageReader,
    weather: WeatherService,
    downloads: FileDownloader,
  ) {
    this.#conversations = conversations;
    this.#participants = participants;
    this.#library = library;
    this.#calculator = calculator;
    this.#pages = pages;
    this.#weather = weather;
    this.#downloads = downloads;
  }

  /**
   * The tools for one answer in `conversationId`, each refusing past its cap, and `filesMessage`, what the files they
   * read give the model. `owners`: the conversation's participants. A conversation shared with others gets none of
   * the user's other conversations or library: what a tool reads is saved in the answer every member sees.
   * `capabilities`: the answering model's, for what a file read for this answer gives it.
   */
  for(
    user: User,
    conversationId: string,
    abortSignal: AbortSignal,
    owners: readonly number[],
    capabilities: readonly ModelCapability[],
  ) {
    const calls: Partial<Record<ContextToolName, number>> = {};
    // Asked for in parallel, past the cap: the refusal reaches the model, which answers with what it has.
    const spend = (name: ContextToolName) => {
      const used = calls[name] ?? 0;
      if (used >= CONTEXT_TOOL_CAPS[name]) {
        throw new ToolRefusal(`No more ${name} in this answer: answer with what you have.`);
      }
      calls[name] = used + 1;
    };
    // The content of each file read in this answer: it never reaches the saved message.
    const readFiles: { name: string; pieces: ModelPiece[] }[] = [];

    /**
     * The files read so far in this answer, as one user message after the tool results, sent with each step. Inside a
     * tool result, OpenRouter dropped a PDF without a word: Gemini 4 answered it had only the file's size
     * (2026-11-21); pictures came through.
     */
    const filesMessage = (): ModelMessage | null =>
      readFiles.length === 0
        ? null
        : {
            role: 'user',
            content: [
              {
                type: 'text',
                text: '[Fichiers lus par tes outils pour cette réponse ; la conversation ne les garde pas.]',
              },
              ...readFiles.flatMap(({ name, pieces }) => [
                { type: 'text' as const, text: `<file name="${name.replaceAll('"', "'")}">` },
                ...pieces.map((piece) =>
                  piece.type === 'text'
                    ? piece
                    : { type: 'file' as const, mediaType: piece.mediaType, data: piece.data, filename: piece.filename },
                ),
                { type: 'text' as const, text: '</file>' },
              ]),
            ],
          };

    const privateTools = {
      search_conversations: tool({
        description:
          "Search the user's other conversations by their words, when they mention something said before (« comme on en a parlé… »). Returns the matching conversations with a passage each; read one with read_conversation.",
        inputSchema: z.object({ query: z.string().min(1).max(200).describe('A few words the conversation contains.') }),
        execute: async ({ query }): Promise<SearchConversationsOutput> => {
          spend('search_conversations');
          const hits = await this.#conversations.search(user.id, searchTerms(query), FOUND_CONVERSATIONS + 1);
          return {
            results: hits
              .filter((hit) => hit.conversation.id !== conversationId)
              .slice(0, FOUND_CONVERSATIONS)
              .map(({ conversation, snippet }) => ({
                id: conversation.id,
                title: conversation.title,
                updatedAt: conversation.updatedAt.toISOString(),
                snippet: cleanSnippet(snippet)
                  .map((part) => part.text)
                  .join(''),
              })),
          };
        },
      }),

      read_conversation: tool({
        description:
          "Read one of the user's other conversations, found with search_conversations: its messages as text. A long one keeps its latest messages.",
        inputSchema: z.object({ id: z.string().describe('The id from search_conversations.') }),
        execute: async ({ id }): Promise<ReadConversationOutput> => {
          spend('read_conversation');
          if (id === conversationId) throw new ToolRefusal('This is the current conversation: you already have it.');
          const access = await this.#participants.access(user, id);
          if (!access || isOutsideHistory(access.conversation)) throw new ToolRefusal('No conversation with this id.');
          const lines = (await this.#conversations.messages(id)).map((message) => {
            const files = attachedNames(message);
            return `${message.role === 'user' ? 'User' : 'Assistant'}: ${textOf(message)}${files ? ` [Attached: ${files}]` : ''}`;
          });
          const text = lines.join('\n\n');
          const shortened = text.length > CONVERSATION_CHARACTERS;
          return {
            id,
            title: access.conversation.title,
            text: shortened ? `…${text.slice(-CONVERSATION_CHARACTERS)}` : text,
            shortened,
          };
        },
      }),

      list_files: tool({
        description:
          "List the files of the user's library (« Mes fichiers »), newest first, when they mention a file they did not attach here. Read one with read_file.",
        inputSchema: z.object({}),
        execute: async (): Promise<ListFilesOutput> => {
          spend('list_files');
          const files = await this.#library.list(user);
          return {
            files: files.slice(0, LISTED_FILES).map((file) => ({
              id: file.id,
              name: file.name,
              kind: file.kind,
              size: file.size,
              createdAt: file.createdAt.toISOString(),
            })),
          };
        },
      }),

      read_file: tool({
        description:
          "Read the text of a file of the user's library, found with list_files. Its pictures (photos, scanned pages) are not included: to see them, ask the user to attach the file.",
        inputSchema: z.object({ id: z.string().describe('The id from list_files.') }),
        execute: async ({ id }): Promise<ReadFileOutput> => {
          spend('read_file');
          const found = await this.#library.text(user, id);
          if (!found) throw new ToolRefusal('No file with this id in the library.');
          if (found.file.kind === 'audio' || found.file.kind === 'video') {
            throw new ToolRefusal('This file is a recording or a video: ask the user to attach it to their message.');
          }
          if (estimatedTokens([{ type: 'text', text: found.text }]) > READ_FILE_TOKENS) {
            throw new ToolRefusal('This file is too long to read here: ask the user to attach it to their message.');
          }
          return { id, name: found.file.name, text: found.text, hasPictures: found.hasPictures };
        },
      }),
    };

    const tools = {
      ...(owners.length > 1 ? {} : privateTools),
      read_web_page: tool({
        description:
          'Read a web page whose address the user gave, or one found with web_search when its extract is not enough. Returns its readable text.',
        inputSchema: z.object({ url: z.string().min(1).max(2000).describe('The whole address, with https://.') }),
        execute: async ({ url }): Promise<ReadWebPageOutput> => {
          spend('read_web_page');
          const page = await this.#pages.read(url, abortSignal);
          const shortened = page.text.length > PAGE_CHARACTERS;
          return {
            url: page.url,
            title: page.title,
            text: shortened ? page.text.slice(0, PAGE_CHARACTERS) : page.text,
            shortened,
          };
        },
      }),

      download_file: tool({
        description:
          'Download a file from a public link (a PDF, a picture, a recording, a video, a Word, Excel or text file) and read it for this answer only. Use it for any link to a file, instead of asking the user to open it. The file is not saved: in a later answer, download it again if you need it.',
        inputSchema: z.object({ url: z.string().min(1).max(2000).describe('The whole address, with https://.') }),
        execute: async ({ url }): Promise<DownloadFileOutput> => {
          spend('download_file');
          const file = await this.#downloads.download(url, abortSignal);
          const read = await this.#library.readDownload(file, capabilities);
          if (!read.ok) {
            throw new ToolRefusal(
              read.detail ? `${DOWNLOAD_REFUSALS[read.reason]} ${read.detail}` : DOWNLOAD_REFUSALS[read.reason],
            );
          }
          readFiles.push({ name: read.name, pieces: read.pieces });
          return { url: file.url, name: read.name, kind: read.kind, size: read.size };
        },
        toModelOutput,
      }),

      read_attachment: tool({
        description:
          'Read again, whole, a file attached or made earlier in this conversation (its id is in the note that replaced it), for this answer only. Use it when a question is about such a file, instead of answering from memory.',
        inputSchema: z.object({ id: z.string().max(100).describe('The file id from the note.') }),
        execute: async ({ id }): Promise<ReadAttachmentOutput> => {
          spend('read_attachment');
          const found = await this.#library.readAttachment(conversationId, owners, id, capabilities);
          if (!found) throw new ToolRefusal('No file with this id was attached or made in this conversation.');
          readFiles.push({ name: found.file.name, pieces: found.pieces });
          return { id: found.file.id, name: found.file.name, kind: found.file.kind };
        },
        toModelOutput,
      }),

      weather: tool({
        description:
          'The weather now and the forecast, day by day, for a place. Use it instead of web_search for the weather; when the user names no place, use where they live if you know it, else ask.',
        inputSchema: z.object({
          place: z.string().min(1).max(100).describe('A town, with its country when it could be ambiguous.'),
          days: z.number().int().min(1).max(7).describe('Days of forecast from today, 1 to 7.'),
        }),
        execute: async ({ place, days }): Promise<WeatherOutput> => {
          spend('weather');
          return await this.#weather.forecast(place, days, user.locale, abortSignal);
        },
      }),

      calculate: tool({
        description:
          'Compute exactly: sums of prices, budgets, percentages (« 15% * 80 »), averages, unit conversions (« 5 km to mile »). Use it for any calculation with more than one step instead of computing in your head.',
        inputSchema: z.object({
          expression: z.string().min(1).max(500).describe('One expression, in mathjs syntax: "1250 * 1.2 - 300".'),
        }),
        execute: async ({ expression }): Promise<CalculateOutput> => {
          spend('calculate');
          return { expression, result: this.#calculator.evaluate(expression) };
        },
      }),

      days_between: tool({
        description: 'The number of days between two dates, and their weekdays.',
        inputSchema: z.object({
          from: z.string().describe('YYYY-MM-DD.'),
          to: z.string().describe('YYYY-MM-DD.'),
        }),
        execute: async ({ from, to }): Promise<DaysBetweenOutput> => {
          spend('days_between');
          const [start, end] = [dateOf(from), dateOf(to)];
          return {
            from,
            to,
            days: daysBetween(start, end),
            fromWeekday: weekdayOf(start),
            toWeekday: weekdayOf(end),
          };
        },
      }),

      date_plus_days: tool({
        description: 'The date a number of days after (or before, when negative) a date, and its weekday.',
        inputSchema: z.object({
          date: z.string().describe('YYYY-MM-DD.'),
          days: z.number().int().min(-36_500).max(36_500),
        }),
        execute: async ({ date, days }): Promise<DatePlusDaysOutput> => {
          spend('date_plus_days');
          const result = plusDays(dateOf(date), days);
          return { date, days, result: formatDay(result), weekday: weekdayOf(result) };
        },
      }),
    };
    return { tools, filesMessage };
  }
}

function dateOf(text: string): Date {
  const date = parseDay(text);
  if (!date) throw new ToolRefusal(`"${text}" is not a date: write it as YYYY-MM-DD.`);
  return date;
}
