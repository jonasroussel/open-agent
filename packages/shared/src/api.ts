import type { UIMessage } from 'ai';

import type { FileKind } from './files.ts';
import type { Locale } from './locale.ts';
import type { ModelCapability, ModelRole, PromptName } from './settings.ts';

/** Bun route patterns; the client fills the `:params` with `apiPath`. */
export const API_ROUTES = {
  health: '/api/health',
  /** GET: the signed-in user. DELETE: signs out. */
  session: '/api/session',
  /** POST `SignInRequestBody`: emails a link and a code when the address is invited. Always 204, invited or not. */
  signInRequests: '/api/sign-in/requests',
  /** POST `SignInWithTokenBody`: the link's token; opens a session. */
  signInWithToken: '/api/sign-in/token',
  /** POST `SignInWithCodeBody`: the code typed in the app (the installed app on iOS cannot open the link). */
  signInWithCode: '/api/sign-in/code',
  /** GET: everyone with access. POST `InviteUserBody`: gives access (again) and emails an invitation. */
  adminUsers: '/api/admin/users',
  /** PATCH `UpdateAdminUserBody`: sets the monthly quota. DELETE: revokes the access and ends every session. */
  adminUser: '/api/admin/users/:userId',
  /** GET: how much of their monthly quota the signed-in user has used, as `QuotaResponse`. */
  quota: '/api/quota',
  /** GET: server-sent events, one `ChangeEvent` per `data:` line, for every change to the signed-in user's data. */
  events: '/api/events',
  /**
   * GET: the signed-in user's own OpenRouter key, as `OwnKeyResponse`. PUT `SetOwnKeyBody`: checks it with OpenRouter
   * and keeps it encrypted. DELETE: forgets it.
   */
  ownKey: '/api/own-key',
  /** GET: the signed-in user's conversations, last updated first. */
  conversations: '/api/conversations',
  /** GET: one conversation with its messages. PATCH `UpdateConversationBody`. DELETE. */
  conversation: '/api/conversations/:conversationId',
  /** GET `?q=`: full-text search in the signed-in user's history, as `SearchResponse`. */
  search: '/api/search',
  /**
   * POST, the AI SDK chat transport: `{ id, messages }` with the whole history; creates the conversation on its first
   * message. Answers a UI message stream.
   */
  chat: '/api/chat',
  /** GET: the signed-in user's rules, as `ListMemoryRulesResponse`. POST `MemoryRuleBody`: adds one. */
  memoryRules: '/api/memory/rules',
  /** PATCH `MemoryRuleBody`: rewrites the rule. DELETE: forgets it. */
  memoryRule: '/api/memory/rules/:ruleId',
  /** POST: undoes a change the assistant made from a remark; also marks its notice in the conversation as undone. */
  memoryChangeUndo: '/api/memory/changes/:changeId/undo',
  /** POST `RememberMessageBody`: keeps what lasts in one of the user's messages, as `RememberMessageResponse`. */
  memoryRemember: '/api/memory/remember',
  /** GET: the signed-in user's commands, in their order, as `ListCommandsResponse`. POST `CommandBody`: adds one, first. */
  commands: '/api/commands',
  /** PUT `CommandOrderBody`: the user's new order. */
  commandOrder: '/api/commands/order',
  /** PATCH `CommandBody`: renames it or rewrites its prompt. DELETE: removes it. */
  command: '/api/commands/:commandId',
  /** GET: the signed-in user's files, newest first. POST multipart, field `file`: uploads one, as `UploadFileResponse`. */
  files: '/api/files',
  /** GET: the file itself, only for its owner. DELETE: removes it from the library. */
  file: '/api/files/:fileId',
  /** GET: the picture that shows the file in "My files" (`LibraryFileDto.previewUrl`), only for its owner. */
  filePreview: '/api/files/:fileId/preview',
  /** GET: the conversation's canvas documents, as `ListArtifactsResponse`. */
  conversationArtifacts: '/api/conversations/:conversationId/artifacts',
  /** GET: one document with its latest content and its versions, as `ArtifactResponse`. */
  artifact: '/api/artifacts/:artifactId',
  /** POST `SaveArtifactBody`: the user's edit, or an old version brought back. */
  artifactVersions: '/api/artifacts/:artifactId/versions',
  /** GET: one version's content, as `ArtifactVersionResponse`. */
  artifactVersion: '/api/artifacts/:artifactId/versions/:number',
  /** GET: the models and prompts in use, and their defaults, as `AdminSettingsResponse`. */
  adminSettings: '/api/admin/settings',
  /** PUT `UpdateModelBody`: the model of a role, checked against OpenRouter. */
  adminModel: '/api/admin/settings/models/:role',
  /** PUT `UpdatePromptBody`: a prompt's text; `null` brings back the default. */
  adminPrompt: '/api/admin/settings/prompts/:name',
  /** GET: OpenRouter's models with their prices and capabilities, as `ListModelsResponse`. */
  adminModels: '/api/admin/models',
  /** GET: a person's memory rules, as `ListMemoryRulesResponse`. */
  adminUserMemory: '/api/admin/users/:userId/memory',
  /** DELETE: forgets one of a person's rules. */
  adminUserMemoryRule: '/api/admin/users/:userId/memory/:ruleId',
} as const;

export function apiPath(route: string, params: Record<string, string | number>): string {
  return route.replace(/:(\w+)/g, (_, name: string) => encodeURIComponent(String(params[name])));
}

/** Error bodies always have this shape; the client turns the code into a translated message. */
export type ApiError = {
  error:
    | 'not_found'
    | 'invalid_request'
    | 'not_signed_in'
    | 'not_admin'
    | 'too_many_attempts'
    /** The link or code is wrong, already used, or expired. */
    | 'invalid_sign_in'
    /** The email provider refused or could not be reached. */
    | 'email_failed'
    | 'cannot_revoke_self'
    /** The model provider failed before the answer started. */
    | 'model_unavailable'
    /** A user has at most `MAX_MEMORY_RULES` rules. */
    | 'memory_full'
    /** Another of the user's commands has this name. */
    | 'command_name_taken'
    /** A user has at most `MAX_COMMANDS` commands. */
    | 'commands_full'
    /** The rule changed again since, or the change was already undone: undoing it would lose the newer state. */
    | 'memory_changed'
    /** The user spent their monthly quota; it comes back on the 1st, see `QuotaResponse.resetsAt`. */
    | 'quota_exceeded'
    /** Larger than `MAX_FILE_BYTES`. */
    | 'file_too_large'
    /** Not an image, PDF, Word or text file. */
    | 'file_type_unsupported'
    /** Broken, protected by a password, or without anything to read. */
    | 'file_unreadable'
    /** More than the model can read at once; it is refused rather than read in part. */
    | 'file_too_long'
    /** The document changed since the version the user edited (the model rewrote it meanwhile). */
    | 'artifact_changed'
    /** OpenRouter has no model with this id. */
    | 'model_not_found'
    /** The model lacks what its role needs (pictures, tools, thinking or JSON). */
    | 'model_unsuitable'
    /** OpenRouter refused the key. */
    | 'invalid_key'
    /** OpenRouter could not be reached to check the key. */
    | 'key_check_failed';
};

/** The text of a failed answer when OpenRouter refused the user's own key: the client explains what to fix. */
export const OWN_KEY_REFUSED = 'own_key_refused';

export type HealthResponse = { status: 'ok'; version: string };

/**
 * Something of the user's changed, maybe on another of their devices: the client reloads it. Only what changed, never
 * the data itself.
 */
export type ChangeEvent =
  /** Its messages changed (an answer, an edit, a deletion); the conversation list and the quota with them. */
  | { type: 'conversation'; id: string }
  /** The list only: a title, an icon, a pin. */
  | { type: 'conversations' }
  | { type: 'memory' }
  | { type: 'files' }
  | { type: 'commands' }
  /** A new version of a canvas document. */
  | { type: 'artifact'; id: string };

export type UserRole = 'user' | 'admin';

export type SignedInUser = { id: number; email: string; role: UserRole };

export type SessionResponse = { user: SignedInUser };

export type SignInRequestBody = { email: string; locale: Locale };
export type SignInWithTokenBody = { token: string };
export type SignInWithCodeBody = { email: string; code: string };

/** `invited`: never signed in yet. */
export type UserStatus = 'invited' | 'active' | 'revoked';

export type AdminUserDto = {
  id: number;
  email: string;
  role: UserRole;
  status: UserStatus;
  invitedAt: string;
  lastSignInAt: string | null;
  /** Spent this calendar month on the app's key, in USD. */
  monthCostUsd: number;
  /** USD per month; `null` for admins, who have no limit. */
  monthlyQuotaUsd: number | null;
  /** Pays with their own OpenRouter key: their calls no longer count in `monthCostUsd`, nor against the quota. */
  ownKey: boolean;
};

/** The admin page refuses more: a typo should not open the budget. */
export const MAX_MONTHLY_QUOTA_USD = 100;

export type UpdateAdminUserBody = { monthlyQuotaUsd: number };

/** Users see a share of their quota, never dollars. */
export type QuotaResponse = {
  /** Admins, and anyone paying with their own OpenRouter key, have no limit. */
  unlimited: boolean;
  /** The user pays with their own OpenRouter key. */
  ownKey: boolean;
  /** Whole percents, capped at 100. */
  percentUsed: number;
  exhausted: boolean;
  /** The 1st of next month, at midnight in Paris. */
  resetsAt: string;
};

/** `hint`: the key's last characters, so the person recognizes it; the key itself never leaves the server. */
export type OwnKeyResponse = { key: { hint: string; addedAt: string } | null };

export type SetOwnKeyBody = { key: string };

export type ListAdminUsersResponse = { users: AdminUserDto[] };

export type InviteUserBody = { email: string; locale: Locale };
export type InviteUserResponse = { user: AdminUserDto };

/** How an answer was made: quick, after thinking, or a question back because the request was ambiguous. */
export type AnswerRoute = 'fast' | 'reasoning' | 'clarify';

/**
 * An assistant message: how it was made. A user message: the command it runs, shown as a badge; the server adds the
 * command's prompt for the model, by its id.
 */
export type ChatMessageMetadata = {
  route?: AnswerRoute;
  /** The clearer request the model answered instead of the user's own words; never shown, kept to check the rewrites. */
  rewrittenRequest?: string;
  command?: { id: string; name: string };
};

/** What a memory change looks like in the conversation, under the answer to the remark that caused it. */
export type MemoryNotice = {
  changeId: number;
  operation: MemoryOperation;
  /** The rule before the change; `null` for an addition. */
  before: string | null;
  /** The rule after the change; `null` for a deletion. */
  after: string | null;
  undone: boolean;
};

/** Custom parts of a message: `data-memory` is a `MemoryNotice`. */
export type ChatDataParts = { memory: MemoryNotice };

/** A page found by the web search: the model reads its content, the user sees its title and link. */
export type WebResult = { title: string; url: string; content: string; publishedAt: string | null };

export type WebSearchInput = {
  query: string;
  /** Only pages from the last few days: news, prices, events. */
  recent: boolean;
};

export type WebSearchOutput = { results: WebResult[] };

/** A canvas document: Markdown text, or a whole HTML page with its CSS and JavaScript inline. */
export type ArtifactKind = 'document' | 'html';

export type ArtifactAuthor = 'model' | 'user';

/** The model writes the whole content, a new document or a new version of one. */
export type CreateDocumentInput = { kind: ArtifactKind; title: string; content: string };
export type UpdateDocumentInput = { id: string; content: string };
export type DocumentToolOutput = { id: string; kind: ArtifactKind; title: string; version: number };

/** A question to the user, with up to `MAX_ASK_OPTIONS` short answers to tap; they may also type their own. */
export type AskUserInput = { question: string; options: string[] };
/**
 * The user's answer. `null`: never answered, either because the user wrote something else, or because a question was
 * already asked in this answer and the model must decide alone.
 */
export type AskUserOutput = { answer: string | null };

export const MAX_ASK_OPTIONS = 4;
/** The longest answer the server accepts: a typed answer is a few sentences, not a document to attach. */
export const MAX_ASK_ANSWER_LENGTH = 4000;

/** One of the user's other conversations the model found by its words. */
export type FoundConversation = { id: string; title: string | null; updatedAt: string; snippet: string };
export type SearchConversationsOutput = { results: FoundConversation[] };
/** `text`: its messages, "User:" and "Assistant:", the oldest cut first when it is long (`shortened`). */
export type ReadConversationOutput = { id: string; title: string | null; text: string; shortened: boolean };

export type LibraryFileSummary = { id: string; name: string; kind: FileKind; size: number; createdAt: string };
export type ListFilesOutput = { files: LibraryFileSummary[] };
/** The file's text; its pictures are not in it (the user can attach the file for the model to see them). */
export type ReadFileOutput = { id: string; name: string; text: string; hasPictures: boolean };

/** The readable text of a page the user gave, `shortened` past what the model reads. */
export type ReadWebPageOutput = { url: string; title: string | null; text: string; shortened: boolean };

export type WeatherInput = { place: string; days: number };
export type WeatherDay = {
  date: string;
  /** In words, in English: "light rain", "clear sky". */
  sky: string;
  minC: number;
  maxC: number;
  rainChance: number | null;
  rainMm: number | null;
};
export type WeatherOutput = {
  /** The place found, as "Nantes, Pays de la Loire, France". */
  place: string;
  now: { sky: string; temperatureC: number; feelsLikeC: number; windKmh: number };
  days: WeatherDay[];
};

export type CalculateOutput = { expression: string; result: string };

export type DaysBetweenOutput = { from: string; to: string; days: number; fromWeekday: string; toWeekday: string };
export type DatePlusDaysOutput = { date: string; days: number; result: string; weekday: string };

/** A file the assistant made, saved in the user's library: the answer shows it, with a download. */
export type MadeFileOutput = { id: string; name: string; kind: FileKind; mediaType: string; size: number };

/** Landscape or portrait: the image model draws these two shapes. */
export type ImageAspect = '16:9' | '9:16';
export const IMAGE_ASPECTS: readonly ImageAspect[] = ['16:9', '9:16'];
/** `sourceImageIds`: images of the user's library (attached ones show their id) to start from or to change. */
export type GenerateImageInput = { prompt: string; aspect: ImageAspect; fileName: string; sourceImageIds?: string[] };

export type SpreadsheetFormat = 'text' | 'number' | 'integer' | 'euro' | 'percent' | 'date';
export const SPREADSHEET_FORMATS: readonly SpreadsheetFormat[] = [
  'text',
  'number',
  'integer',
  'euro',
  'percent',
  'date',
];
export type SpreadsheetCell = string | number | boolean | null;
/** A cell text starting with "=" is a formula; a `date` column takes "YYYY-MM-DD". */
export type SpreadsheetSheet = {
  name: string;
  columns: { header: string; format?: SpreadsheetFormat; width?: number }[];
  rows: SpreadsheetCell[][];
};
export type CreateSpreadsheetInput = { fileName: string; sheets: SpreadsheetSheet[] };
/** `markdown` may show images of the user's library as `![caption](file id)`. */
export type CreatePdfInput = { fileName: string; markdown: string; landscape?: boolean };
/** `spec`: a Vega-Lite chart with its data inline. */
export type CreateChartInput = { fileName: string; spec: Record<string, unknown> };
export type CreateQrCodeInput = { fileName: string; text: string };

export type ChatTools = {
  web_search: { input: WebSearchInput; output: WebSearchOutput };
  create_document: { input: CreateDocumentInput; output: DocumentToolOutput };
  update_document: { input: UpdateDocumentInput; output: DocumentToolOutput };
  ask_user: { input: AskUserInput; output: AskUserOutput };
  search_conversations: { input: { query: string }; output: SearchConversationsOutput };
  read_conversation: { input: { id: string }; output: ReadConversationOutput };
  list_files: { input: Record<string, never>; output: ListFilesOutput };
  read_file: { input: { id: string }; output: ReadFileOutput };
  read_web_page: { input: { url: string }; output: ReadWebPageOutput };
  weather: { input: WeatherInput; output: WeatherOutput };
  calculate: { input: { expression: string }; output: CalculateOutput };
  days_between: { input: { from: string; to: string }; output: DaysBetweenOutput };
  date_plus_days: { input: { date: string; days: number }; output: DatePlusDaysOutput };
  generate_image: { input: GenerateImageInput; output: MadeFileOutput };
  create_spreadsheet: { input: CreateSpreadsheetInput; output: MadeFileOutput };
  create_pdf: { input: CreatePdfInput; output: MadeFileOutput };
  create_chart: { input: CreateChartInput; output: MadeFileOutput };
  create_qr_code: { input: CreateQrCodeInput; output: MadeFileOutput };
  save_command: { input: { name: string; prompt: string }; output: SaveCommandOutput };
};

export type ChatMessage = UIMessage<ChatMessageMetadata, ChatDataParts, ChatTools>;

export type ConversationDto = {
  id: string;
  /** `null` until it is named after the first answer. */
  title: string | null;
  /** A Lucide icon name (`fuel`), chosen with the title; the client shows a default one when it is `null` or unknown. */
  icon: string | null;
  pinned: boolean;
  updatedAt: string;
};

export type ListConversationsResponse = { conversations: ConversationDto[] };

export type ConversationResponse = { conversation: ConversationDto; messages: ChatMessage[] };

export type UpdateConversationBody = { title?: string; pinned?: boolean };

/** A title the user writes: about a sidebar row. */
export const MAX_CONVERSATION_TITLE_LENGTH = 80;

/** A search longer than this is refused; a real one is a few words. */
export const MAX_SEARCH_LENGTH = 200;

/** A conversation the search found, with the passage of its best message; `match` parts are the searched words. */
export type SearchResultDto = { conversation: ConversationDto; snippet: { text: string; match: boolean }[] };

export type SearchResponse = { results: SearchResultDto[] };

export const MAX_MEMORY_RULES = 50;
export const MAX_MEMORY_RULE_LENGTH = 300;

export type MemoryOperation = 'add' | 'update' | 'delete';

export type MemoryRuleDto = { id: number; text: string; updatedAt: string };

export type ListMemoryRulesResponse = { rules: MemoryRuleDto[] };

export type MemoryRuleBody = { text: string };

/** `uses`: how many messages ran it, shown in "My commands". */
export type CommandDto = { id: string; name: string; prompt: string; uses: number; updatedAt: string };

export type ListCommandsResponse = { commands: CommandDto[] };

/** `name` as typed after `/` (see `commandNameOf`). */
export type CommandBody = { name: string; prompt: string };

/** Every one of the user's commands, each once, in the order they want. */
export type CommandOrderBody = { ids: string[] };

/** What `save_command` gives the model, and the answer shows: the command and whether it is new. */
export type SaveCommandOutput = { id: string; name: string; created: boolean };

export type RememberMessageBody = { conversationId: string; messageId: string };
/** `notice: null`: the memory already holds it, or nothing in the message lasts. */
export type RememberMessageResponse = { notice: MemoryNotice | null };

/** A file of the user's library. Messages point to it with a `file` part whose `url` is the file's `url`. */
export type LibraryFileDto = {
  id: string;
  name: string;
  kind: FileKind;
  mediaType: string;
  size: number;
  createdAt: string;
  url: string;
  /** An image's own picture or a PDF's first page; `null` for Word and text files, shown by their icon. */
  previewUrl: string | null;
};

export type ListLibraryFilesResponse = { files: LibraryFileDto[] };

export type UploadFileResponse = { file: LibraryFileDto };

/** Enough for a long report; more would make every answer of its conversation expensive. */
export const MAX_ARTIFACT_LENGTH = 200_000;

export type ArtifactDto = {
  id: string;
  conversationId: string;
  kind: ArtifactKind;
  title: string;
  /** The latest version's number, from 1. */
  version: number;
  updatedAt: string;
};

/** `restoredFrom`: the older version the user brought back as this one. */
export type ArtifactVersionDto = {
  number: number;
  author: ArtifactAuthor;
  createdAt: string;
  restoredFrom: number | null;
};

export type ListArtifactsResponse = { artifacts: ArtifactDto[] };

/** The artifact with its latest content, and all its versions, newest first. */
export type ArtifactResponse = { artifact: ArtifactDto; content: string; versions: ArtifactVersionDto[] };

export type ArtifactVersionResponse = ArtifactVersionDto & { content: string };

/**
 * `baseVersion`: the version the user edited; another one since means someone else changed it. `restoredFrom`: the
 * older version brought back, whose content this is.
 */
export type SaveArtifactBody = { content: string; baseVersion: number; restoredFrom?: number };

export type SaveArtifactResponse = { artifact: ArtifactDto };

export type ModelInfoDto = {
  id: string;
  name: string;
  capabilities: ModelCapability[];
  /** USD per million tokens. */
  inputPrice: number;
  outputPrice: number;
};

export type ListModelsResponse = { models: ModelInfoDto[] };

export type AdminSettingsResponse = {
  models: Record<ModelRole, string>;
  defaultModels: Record<ModelRole, string>;
  prompts: Record<PromptName, string>;
  defaultPrompts: Record<PromptName, string>;
};

export type UpdateModelBody = { modelId: string };

/** `text: null` brings back the default. */
export type UpdatePromptBody = { text: string | null };
