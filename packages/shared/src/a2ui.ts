import { z } from 'zod';

/**
 * Generative UI, a subset of A2UI v1.0 (https://a2ui.org/): a flat list of components with ids, `root` first, children
 * named by id, values bound to a JSON data model with `{ "@path": "/x" }`. The catalog is ours, drawn by the client.
 */

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type DataModel = { [key: string]: JsonValue };

export const A2UI_ROOT_ID = 'root';
export const A2UI_MAX_COMPONENTS = 60;
/** Of the whole surface as JSON, data model included; a saved data model has the same cap. */
export const A2UI_MAX_JSON_LENGTH = 20_000;
/** The event of an `ask` answered by typing in the composer instead of the surface: `context` is `{ text }`. */
export const ASK_REPLY_EVENT = 'reply';

const json = z.json() as z.ZodType<JsonValue>;
const dataModelSchema = z.record(z.string(), json) as z.ZodType<DataModel>;

const JSON_POINTER = /^(\/([^~/]|~[01])*)+$/;
export const A2uiBindingSchema = z.strictObject({
  '@path': z.string().regex(JSON_POINTER, 'must be a JSON pointer such as "/items"'),
});
export type A2uiBinding = z.infer<typeof A2uiBindingSchema>;

const id = z.string().min(1).max(64);
const label = z.string().min(1).max(500);

export const TOOL_STATUS_ICONS = [
  'globe',
  'search',
  'messages',
  'file',
  'folder',
  'download',
  'cloud-sun',
  'calculator',
  'calendar',
  'command',
  'loader',
  'alert',
] as const;
export type ToolStatusIcon = (typeof TOOL_STATUS_ICONS)[number];

const column = z.strictObject({ id, component: z.literal('Column'), children: z.array(id).min(1) });
const row = z.strictObject({ id, component: z.literal('Row'), children: z.array(id).min(1) });
const card = z.strictObject({ id, component: z.literal('Card'), child: id });
const text = z.strictObject({
  id,
  component: z.literal('Text'),
  text: z.string().min(1),
  variant: z.enum(['heading', 'body', 'caption']).optional(),
});
const badge = z.strictObject({ id, component: z.literal('Badge'), text: label });
const divider = z.strictObject({ id, component: z.literal('Divider') });
const table = z
  .strictObject({
    id,
    component: z.literal('Table'),
    header: z.array(z.string()).min(1),
    rows: z.array(z.array(z.string())),
  })
  .refine((value) => value.rows.every((cells) => cells.length === value.header.length), {
    message: 'every row must have as many cells as the header',
    path: ['rows'],
  });
const image = z.strictObject({
  id,
  component: z.literal('Image'),
  url: z.string().regex(/^\/api\/files\/[\w-]+$/, "must be one of the app's files: /api/files/<id>"),
  alt: z.string().optional(),
});
const checklist = z.strictObject({
  id,
  component: z.literal('Checklist'),
  items: z.array(z.strictObject({ id, label })).min(1),
  /** An object: item id → `true` when ticked. */
  checked: A2uiBindingSchema,
});
const choiceChips = z.strictObject({
  id,
  component: z.literal('ChoiceChips'),
  options: z.array(z.strictObject({ value: z.string().min(1), label })).min(1),
  multiple: z.boolean().optional(),
  /** A string, or an array of strings when `multiple`. */
  value: A2uiBindingSchema,
});
const textField = z.strictObject({
  id,
  component: z.literal('TextField'),
  label: z.string().optional(),
  placeholder: z.string().optional(),
  value: A2uiBindingSchema,
});
export const A2uiEventSchema = z.strictObject({
  name: z.string().min(1).max(64),
  context: z.record(z.string(), z.union([A2uiBindingSchema, json])).optional(),
});
const button = z
  .strictObject({
    id,
    component: z.literal('Button'),
    label,
    variant: z.enum(['primary', 'secondary']).optional(),
    action: z.strictObject({ event: A2uiEventSchema }).optional(),
    /** The text of a new user message the button sends. */
    message: z.string().min(1).max(2000).optional(),
  })
  .refine((value) => (value.action === undefined) !== (value.message === undefined), {
    message: 'a Button needs exactly one of "action" or "message"',
  });
const toolStatus = z.strictObject({
  id,
  component: z.literal('ToolStatus'),
  icon: z.enum(TOOL_STATUS_ICONS),
  label: z.string(),
  state: z.enum(['running', 'done', 'failed']),
  /** An external URL or one of the app's paths. */
  link: z.string().optional(),
});
const sources = z.strictObject({
  id,
  component: z.literal('Sources'),
  links: z.array(z.strictObject({ url: z.string(), title: z.string().optional() })),
});

const COMPONENT_SCHEMAS = {
  Column: column,
  Row: row,
  Card: card,
  Text: text,
  Badge: badge,
  Divider: divider,
  Table: table,
  Image: image,
  Checklist: checklist,
  ChoiceChips: choiceChips,
  TextField: textField,
  Button: button,
  ToolStatus: toolStatus,
  Sources: sources,
} as const;

/** One component, complete: the client may draw a list still being written one parsed component at a time. */
export const A2uiComponentSchema = z.discriminatedUnion('component', [
  column,
  row,
  card,
  text,
  badge,
  divider,
  table,
  image,
  checklist,
  choiceChips,
  textField,
  button,
  toolStatus,
  sources,
]);
export type A2uiComponent = z.infer<typeof A2uiComponentSchema>;
export type A2uiComponentName = A2uiComponent['component'];
export type A2uiComponentOf<Name extends A2uiComponentName> = Extract<A2uiComponent, { component: Name }>;

/** `show`: a `show_ui` surface. `ask`: a question (`ask`), whose buttons answer it. */
export type SurfacePurpose = 'show' | 'ask';

/** What the model may use; `ToolStatus` and `Sources` are the client's, for tool lines. */
export const MODEL_COMPONENTS: Record<SurfacePurpose, readonly A2uiComponentName[]> = {
  show: ['Column', 'Row', 'Card', 'Text', 'Badge', 'Divider', 'Table', 'Image', 'Checklist', 'ChoiceChips', 'Button'],
  ask: [
    'Column',
    'Row',
    'Card',
    'Text',
    'Badge',
    'Divider',
    'Table',
    'Image',
    'Checklist',
    'ChoiceChips',
    'TextField',
    'Button',
  ],
};

export type Surface = { title?: string; components: A2uiComponent[]; dataModel?: DataModel };

export type ShowUiInput = Surface;
/** The surface's current state: its input's `dataModel` at first, then what the participants ticked or chose. */
export type ShowUiOutput = { dataModel: DataModel };

export type AskInput = { components: A2uiComponent[]; dataModel?: DataModel };
export type AskAction = { name: string; context: { [key: string]: JsonValue } };
/** `null`: never answered (the user wrote something else, or a question was already asked in this answer). */
export type AskOutput = { action: AskAction | null };

/** The body of `API_ROUTES.surfaceState`. */
export type SaveSurfaceStateBody = { dataModel: DataModel };

export const dataModelIsValid = (value: unknown): value is DataModel =>
  dataModelSchema.safeParse(value).success && JSON.stringify(value).length <= A2UI_MAX_JSON_LENGTH;

const QUOTED_BINDING_KEY = /^\s*(['"])@path\1\s*$/;

/**
 * Gemini sometimes writes the binding key with its quotes inside it (`"'@path'"`): those keys become `@path` again,
 * at any depth, before the surface is validated and saved.
 */
export function normalizeBindingKeys<T>(value: T): T {
  if (Array.isArray(value)) return value.map(normalizeBindingKeys) as T;
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      QUOTED_BINDING_KEY.test(key) ? '@path' : key,
      normalizeBindingKeys(item),
    ]),
  ) as T;
}

export type SurfaceValidation = { ok: true } | { ok: false; error: string };

const MAX_REPORTED_ERRORS = 5;

/**
 * Whether the model's surface can be drawn: known components with valid props, unique ids, `root` first, every child
 * existing and used once, no cycle, nothing unreachable, within the size caps. The error is written for the model.
 */
export function validateSurface(surface: unknown, purpose: SurfacePurpose = 'show'): SurfaceValidation {
  if (typeof surface !== 'object' || surface === null || Array.isArray(surface)) {
    return { ok: false, error: 'The surface must be an object with "components".' };
  }
  const { title, components, dataModel } = surface as Record<string, unknown>;
  if (title !== undefined && typeof title !== 'string') return { ok: false, error: '"title" must be a string.' };
  if (dataModel !== undefined && !dataModelSchema.safeParse(dataModel).success) {
    return { ok: false, error: '"dataModel" must be a JSON object.' };
  }
  if (!Array.isArray(components) || components.length === 0) {
    return { ok: false, error: '"components" must be a non-empty array.' };
  }
  if (components.length > A2UI_MAX_COMPONENTS) {
    return { ok: false, error: `Too many components: ${components.length}, at most ${A2UI_MAX_COMPONENTS}.` };
  }
  const length = JSON.stringify(surface).length;
  if (length > A2UI_MAX_JSON_LENGTH) {
    return {
      ok: false,
      error: `The surface is too big: ${length} characters of JSON, at most ${A2UI_MAX_JSON_LENGTH}.`,
    };
  }

  const errors: string[] = [];
  const parsed: A2uiComponent[] = [];
  const allowed = MODEL_COMPONENTS[purpose];
  components.forEach((raw: unknown, index) => {
    const at = componentLabel(raw, index);
    const name = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>).component : undefined;
    if (typeof name !== 'string' || !(allowed as readonly string[]).includes(name)) {
      errors.push(`${at}: unknown component ${JSON.stringify(name)}; use one of ${allowed.join(', ')}.`);
      return;
    }
    const result = COMPONENT_SCHEMAS[name as A2uiComponentName].safeParse(raw);
    if (!result.success) {
      for (const issue of result.error.issues) {
        errors.push(`${at}: ${issue.path.length > 0 ? `${issue.path.join('.')}: ` : ''}${issue.message}.`);
      }
      return;
    }
    parsed.push(result.data);
  });
  if (errors.length === 0) errors.push(...structureErrors(parsed, purpose));
  if (errors.length === 0) return { ok: true };
  return { ok: false, error: errors.slice(0, MAX_REPORTED_ERRORS).join('\n') };
}

function componentLabel(raw: unknown, index: number): string {
  const value = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>).id : undefined;
  return typeof value === 'string' ? `components[${index}] "${value}"` : `components[${index}]`;
}

/** The ids a component names as its children. */
export function childrenOf(component: A2uiComponent): string[] {
  if (component.component === 'Column' || component.component === 'Row') return component.children;
  if (component.component === 'Card') return [component.child];
  return [];
}

function structureErrors(components: readonly A2uiComponent[], purpose: SurfacePurpose): string[] {
  const errors: string[] = [];
  const byId = new Map<string, A2uiComponent>();
  for (const component of components) {
    if (byId.has(component.id)) errors.push(`Duplicate id "${component.id}": every id must be unique.`);
    byId.set(component.id, component);
  }
  if (components[0]?.id !== A2UI_ROOT_ID) errors.push(`The first component must have the id "${A2UI_ROOT_ID}".`);

  const parents = new Map<string, string>();
  for (const component of components) {
    for (const child of childrenOf(component)) {
      if (!byId.has(child)) {
        errors.push(`"${component.id}" names a child "${child}" that does not exist.`);
      } else if (parents.has(child)) {
        errors.push(`"${child}" is the child of both "${parents.get(child)}" and "${component.id}": use it once.`);
      } else {
        parents.set(child, component.id);
      }
    }
  }
  if (errors.length > 0) return errors;

  // Each component has at most one parent: walking up from any one either reaches the root or loops.
  for (const component of components) {
    const seen = new Set<string>([component.id]);
    let current = parents.get(component.id);
    while (current !== undefined && !seen.has(current)) {
      seen.add(current);
      current = parents.get(current);
    }
    if (current !== undefined) {
      errors.push(`"${component.id}" is inside a cycle of children: a component cannot contain itself.`);
      break;
    }
  }
  if (errors.length > 0) return errors;
  for (const component of components) {
    if (component.id !== A2UI_ROOT_ID && !parents.has(component.id)) {
      errors.push(`"${component.id}" is not reachable from "${A2UI_ROOT_ID}": name it as a child or remove it.`);
    }
  }

  for (const component of components) {
    if (component.component !== 'Button') continue;
    if (purpose === 'ask' && !component.action) {
      errors.push(`Button "${component.id}" must answer the question with "action": { "event": { "name" } }.`);
    }
    if (purpose === 'show' && !component.message) {
      errors.push(`Button "${component.id}" must send a "message"; events only answer a question (ask).`);
    }
  }
  if (purpose === 'ask' && !components.some((component) => component.component === 'Button')) {
    errors.push('A question needs at least one Button with an event to answer it.');
  }
  return errors;
}

const isBinding = (value: unknown): value is A2uiBinding =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.keys(value).length === 1 &&
  typeof (value as Record<string, unknown>)['@path'] === 'string';

const tokensOf = (pointer: string) =>
  pointer
    .split('/')
    .slice(1)
    .map((token) => token.replaceAll('~1', '/').replaceAll('~0', '~'));

/** The value at a JSON pointer; `null` when there is none. */
export function readPath(dataModel: JsonValue, pointer: string): JsonValue {
  let current: JsonValue = dataModel;
  for (const token of tokensOf(pointer)) {
    if (Array.isArray(current)) {
      current = current[Number(token)] ?? null;
    } else if (typeof current === 'object' && current !== null) {
      current = current[token] ?? null;
    } else {
      return null;
    }
  }
  return current;
}

/** A copy of the data model with `value` at the pointer, creating the objects on the way. */
export function writePath(dataModel: DataModel, pointer: string, value: JsonValue): DataModel {
  const write = (current: JsonValue, tokens: readonly string[]): JsonValue => {
    const [token, ...rest] = tokens;
    if (token === undefined) return value;
    if (Array.isArray(current)) {
      const copy = [...current];
      copy[Number(token)] = write(current[Number(token)] ?? null, rest);
      return copy;
    }
    const object = typeof current === 'object' && current !== null ? current : {};
    return { ...object, [token]: write(object[token] ?? null, rest) };
  };
  return write(dataModel, tokensOf(pointer)) as DataModel;
}

/** `value` with every `{ "@path" }` replaced by what the data model holds there. */
export function resolveBindings(value: unknown, dataModel: DataModel): JsonValue {
  if (isBinding(value)) return readPath(dataModel, value['@path']);
  if (Array.isArray(value)) return value.map((item) => resolveBindings(item, dataModel));
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveBindings(item, dataModel)]));
  }
  return value === undefined ? null : (value as JsonValue);
}
