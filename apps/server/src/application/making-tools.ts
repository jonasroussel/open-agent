import {
  IMAGE_ASPECTS,
  SPREADSHEET_FORMATS,
  type ImageAspect,
  type MadeFileOutput,
  type SpreadsheetFormat,
} from '@open-agent/shared';
import { APICallError, generateText, tool, type FilePart } from 'ai';
import { z } from 'zod';

import type { User } from '../domain/user.ts';
import type { Library } from './library.ts';
import type { Models } from './models.ts';
import { ToolRefusal } from './ports/context-services.ts';
import { CannotMake, type FileMaker, type PdfImage } from './ports/file-maker.ts';
import type { UsageRecorder } from './usage-recorder.ts';

/**
 * Files made in one answer, per tool. An image costs about 0.034 $, near a hundred everyday answers: two at most,
 * and the user asks again for more.
 */
export const MAKING_TOOL_CAPS = {
  generate_image: 2,
  create_spreadsheet: 2,
  create_pdf: 2,
  create_chart: 3,
  create_qr_code: 2,
} as const;

type MakingToolName = keyof typeof MAKING_TOOL_CAPS;

const MAX_SOURCE_IMAGES = 3;
/** What the image model reads: JPEG, PNG and WebP (Gemini's list). */
const SOURCE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const EXTENSIONS: Record<string, string> = { 'image/png': 'png', 'image/webp': 'webp', 'image/jpeg': 'jpg' };
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
/** Past this, a chart's spec carries data no chart shows readably. */
const MAX_CHART_SPEC_CHARACTERS = 200_000;
const PICTURE = /!\[[^\]]*\]\(\s*<?([^)\s>]+)>?\s*\)/g;

const fileName = z
  .string()
  .min(1)
  .max(80)
  .describe('A short, clear file name in the user\'s language, without extension: "Budget vacances 2027".');

/**
 * What the model makes for the user: images drawn by the image model, Excel workbooks, PDFs, charts and QR codes.
 * Each lands in the user's library ("Mes fichiers") and shows in the answer with a download.
 */
export class MakingTools {
  readonly #library: Library;
  readonly #models: Models;
  readonly #usage: UsageRecorder;
  readonly #maker: FileMaker;

  constructor(library: Library, models: Models, usage: UsageRecorder, maker: FileMaker) {
    this.#library = library;
    this.#models = models;
    this.#usage = usage;
    this.#maker = maker;
  }

  /** The tools for one answer in `conversationId`, each refusing past its cap. */
  for(user: User, conversationId: string, abortSignal: AbortSignal) {
    const calls: Partial<Record<MakingToolName, number>> = {};
    const spend = (name: MakingToolName) => {
      const used = calls[name] ?? 0;
      if (used >= MAKING_TOOL_CAPS[name]) {
        throw new ToolRefusal(`No more ${name} in this answer: tell the user to ask again for more.`);
      }
      calls[name] = used + 1;
    };

    return {
      generate_image: tool({
        description:
          'Draw an image the user asks for (an illustration, a card, a poster, a logo idea). Write the prompt in English, detailed: subject, style, colors, light, framing, and any text to show in quotes. To change an image (one the user attached, or one drawn before: its id is in that generate_image result), pass its id in sourceImageIds and say only what to change, so the rest stays the same. The image is shown to the user: do not describe it at length afterwards.',
        inputSchema: z.object({
          prompt: z.string().min(1).max(4_000),
          aspect: z
            .enum(IMAGE_ASPECTS as [ImageAspect, ...ImageAspect[]])
            .describe('16:9 landscape (default), 9:16 portrait (phone wallpaper, story, poster).'),
          fileName,
          sourceImageIds: z
            .array(z.string())
            .max(MAX_SOURCE_IMAGES)
            .optional()
            .describe('Ids of images to start from: attached ones (<file id="…">), from list_files, or drawn before.'),
        }),
        execute: async ({ prompt, aspect, fileName: name, sourceImageIds }): Promise<MadeFileOutput> => {
          spend('generate_image');
          const sources = await Promise.all((sourceImageIds ?? []).map((id) => this.#sourceImage(user, id)));
          const choice = this.#models.choose('image', user);
          let result;
          try {
            result = await generateText({
              model: choice.model,
              messages: [{ role: 'user', content: [...sources, { type: 'text', text: prompt }] }],
              providerOptions: { openrouter: { image_config: { aspect_ratio: aspect } } },
              abortSignal,
            });
          } catch (error) {
            // A prompt the provider refuses (safety, a picture it cannot read): the model may rewrite it.
            if (APICallError.isInstance(error) && error.statusCode === 400) {
              throw new ToolRefusal(`The image model refused: ${error.message.slice(0, 300)}`);
            }
            throw error;
          }
          await this.#usage.record(user, conversationId, 'image', choice, result.usage, result.providerMetadata);
          const image = result.files.find((file) => file.mediaType.startsWith('image/'));
          if (!image) {
            const said = result.text.trim();
            throw new ToolRefusal(`The image model drew nothing${said ? `, saying: ${said.slice(0, 300)}` : '.'}`);
          }
          return await this.#save(user, name, image.mediaType, image.uint8Array);
        },
      }),

      create_spreadsheet: tool({
        description:
          'Make an Excel file (.xlsx) the user can download: a budget, a schedule, a list, a table to fill. Use formulas ("=SUM(B2:B9)") for totals, so the file stays right when the user edits it.',
        inputSchema: z.object({
          fileName,
          sheets: z
            .array(
              z.object({
                name: z.string().min(1).max(31),
                columns: z
                  .array(
                    z.object({
                      header: z.string().max(100),
                      format: z
                        .enum(SPREADSHEET_FORMATS as [SpreadsheetFormat, ...SpreadsheetFormat[]])
                        .optional()
                        .describe('euro: amounts; percent: 0.15 for 15 %; date: cells as YYYY-MM-DD.'),
                      width: z.number().min(4).max(100).optional(),
                    }),
                  )
                  .min(1)
                  .max(50),
                rows: z
                  .array(z.array(z.union([z.string().max(2_000), z.number(), z.boolean(), z.null()])).max(50))
                  .max(5_000)
                  .describe('One array per row, in the order of the columns. A text starting with "=" is a formula.'),
              }),
            )
            .min(1)
            .max(10),
        }),
        execute: async ({ fileName: name, sheets }): Promise<MadeFileOutput> => {
          spend('create_spreadsheet');
          const bytes = await this.#maker.spreadsheet(sheets);
          return await this.#save(user, name, XLSX, bytes, 'xlsx');
        },
      }),

      create_pdf: tool({
        description:
          'Make a PDF file the user can download, from Markdown: titles, paragraphs, bold, lists, tables, links, quotes. Use it only when the user asks for a PDF file; for a text to read or edit, use create_document. Show an image of their library alone on its line as ![caption](file id).',
        inputSchema: z.object({
          fileName,
          markdown: z.string().min(1).max(100_000),
          landscape: z.boolean().optional().describe('Landscape A4, for wide tables.'),
        }),
        execute: async ({ fileName: name, markdown, landscape }): Promise<MadeFileOutput> => {
          spend('create_pdf');
          const ids = new Set([...markdown.matchAll(PICTURE)].map((match) => match[1]!));
          const images = new Map(
            await Promise.all([...ids].map(async (id) => [id, await this.#pdfImage(user, id)] as const)),
          );
          const bytes = await this.#maker.pdf(markdown, images, landscape ?? false);
          return await this.#save(user, name, 'application/pdf', bytes, 'pdf');
        },
      }),

      create_chart: tool({
        description:
          "Draw a chart as a picture (bars, lines, pie, …) from numbers: a Vega-Lite v5 spec with its data inline in data.values, a title, and axis titles in the user's language. Use it when the user asks for a chart or when one says more than a table.",
        inputSchema: z.object({
          fileName,
          spec: z.record(z.string(), z.unknown()).describe('The Vega-Lite spec. Never data.url.'),
        }),
        execute: async ({ fileName: name, spec }): Promise<MadeFileOutput> => {
          spend('create_chart');
          if (JSON.stringify(spec).length > MAX_CHART_SPEC_CHARACTERS) {
            throw new CannotMake('The chart has too much data: group or summarize it first.');
          }
          return await this.#save(user, name, 'image/png', await this.#maker.chart(spec), 'png');
        },
      }),

      create_qr_code: tool({
        description:
          'Make a QR code picture: a link, a text, a Wi-Fi network to join ("WIFI:T:WPA;S:<name>;P:<password>;;"), a contact (a vCard).',
        inputSchema: z.object({ fileName, text: z.string().min(1).max(1_500) }),
        execute: async ({ fileName: name, text }): Promise<MadeFileOutput> => {
          spend('create_qr_code');
          return await this.#save(user, name, 'image/png', await this.#maker.qrCode(text), 'png');
        },
      }),
    };
  }

  async #sourceImage(user: User, id: string): Promise<FilePart> {
    const opened = await this.#library.open(user, id);
    if (!opened) throw new ToolRefusal(`No file with the id "${id}" in the user's library.`);
    if (!SOURCE_TYPES.includes(opened.file.mediaType)) {
      throw new ToolRefusal(`"${opened.file.name}" is not a JPEG, PNG or WebP picture: the image model cannot use it.`);
    }
    return { type: 'file', data: opened.bytes, mediaType: opened.file.mediaType };
  }

  async #pdfImage(user: User, id: string): Promise<PdfImage> {
    const opened = await this.#library.open(user, id);
    if (!opened) throw new CannotMake(`No image with the id "${id}" in the user's library.`);
    const { mediaType } = opened.file;
    if (mediaType !== 'image/jpeg' && mediaType !== 'image/png') {
      throw new CannotMake(`"${opened.file.name}" is not a JPEG or PNG picture: a PDF cannot show it.`);
    }
    return { bytes: opened.bytes, mediaType };
  }

  /** Into the library, read like an upload: the model can read the file again later with read_file. */
  async #save(
    user: User,
    name: string,
    mediaType: string,
    bytes: Uint8Array,
    extension = EXTENSIONS[mediaType] ?? 'bin',
  ): Promise<MadeFileOutput> {
    const base = name.replace(/\.[a-z0-9]{2,5}$/i, '').trim() || 'Fichier';
    const saved = await this.#library.upload(user, { name: `${base}.${extension}`, mediaType, bytes });
    if (!saved.ok) throw new ToolRefusal(`The file could not be kept (${saved.reason.replaceAll('_', ' ')}).`);
    const { file } = saved;
    return { id: file.id, name: file.name, kind: file.kind, mediaType: file.mediaType, size: file.size };
  }
}
