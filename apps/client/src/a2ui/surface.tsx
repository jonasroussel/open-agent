import {
  A2UI_ROOT_ID,
  A2uiComponentSchema,
  normalizeBindingKeys,
  readPath,
  resolveBindings,
  validateSurface,
  writePath,
  type A2uiComponent,
  type A2uiComponentOf,
  type AskAction,
  type DataModel,
  type JsonValue,
  type SurfacePurpose,
  type ToolStatusIcon,
} from '@open-agent/shared';
import { useNavigate } from '@tanstack/react-router';
import {
  Calculator,
  CalendarDays,
  Check,
  CloudSun,
  Download,
  FileText,
  FolderOpen,
  Globe,
  LoaderCircle,
  MessagesSquare,
  Search,
  SquareSlash,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import { Fragment, useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Card, CardContent } from '@/components/ui/card.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Label } from '@/components/ui/label.tsx';
import { Separator } from '@/components/ui/separator.tsx';
import { cn } from '@/lib/utils.ts';

import { siteOf } from './tool-surfaces.ts';

const ICONS: Record<ToolStatusIcon, LucideIcon> = {
  globe: Globe,
  search: Search,
  messages: MessagesSquare,
  file: FileText,
  folder: FolderOpen,
  download: Download,
  'cloud-sun': CloudSun,
  calculator: Calculator,
  calendar: CalendarDays,
  command: SquareSlash,
  loader: LoaderCircle,
  alert: TriangleAlert,
};

/** What can answer: the user's own controls, hidden once the question is answered (its answer shows instead). */
const INPUTS: Partial<Record<A2uiComponent['component'], true>> = {
  Checklist: true,
  ChoiceChips: true,
  TextField: true,
  Button: true,
};

type Context = {
  byId: Map<string, A2uiComponent>;
  dataModel: DataModel;
  /** Absent: nothing can be changed, nor sent. */
  onChange: ((dataModel: DataModel) => void) | null;
  onAction: ((action: AskAction) => void) | null;
  onSend: ((text: string) => void) | null;
  hideInputs: boolean;
};

/**
 * A surface the model composed from our catalog (A2UI's shapes), or a tool line the app made: drawn from `root`, its
 * controls bound to the data model, changed locally then handed to `onChange`. While the model still writes it
 * (`streaming`), each component shows once complete. `purpose`: the model's surface, checked before it is drawn; a
 * broken one says so in a muted line instead of breaking the answer.
 */
export function Surface({
  surface,
  dataModel,
  purpose,
  streaming = false,
  readOnly = false,
  hideInputs = false,
  onChange = null,
  onAction = null,
  onSend = null,
}: {
  /** Possibly still being written by the model. */
  surface: { title?: unknown; components?: unknown } | undefined;
  dataModel: DataModel;
  purpose?: SurfacePurpose;
  streaming?: boolean;
  readOnly?: boolean;
  hideInputs?: boolean;
  onChange?: ((dataModel: DataModel) => void) | null;
  onAction?: ((action: AskAction) => void) | null;
  onSend?: ((text: string) => void) | null;
}) {
  const { t } = useTranslation();
  if (!surface) return null;
  // The streamed input is the model's own, before the server repairs its `'@path'` keys as it saves it.
  const spec = purpose ? normalizeBindingKeys(surface) : surface;
  if (purpose && !streaming && !validateSurface(spec, purpose).ok) {
    return <p className='text-muted-foreground text-sm'>{t('a2ui.invalid')}</p>;
  }
  // Checked above, or made by the app itself.
  const components = streaming ? completeOf(spec.components) : (spec.components as A2uiComponent[]);
  const context: Context = {
    byId: new Map(components.map((component) => [component.id, component])),
    dataModel,
    onChange: readOnly ? null : onChange,
    onAction: readOnly ? null : onAction,
    onSend: readOnly ? null : onSend,
    hideInputs,
  };
  const root = renderNode(A2UI_ROOT_ID, context, new Set());
  if (!root) return null;
  return (
    <div className='grid min-w-0 gap-2'>
      {typeof spec.title === 'string' && spec.title && (
        <p className='font-heading text-base font-semibold'>{spec.title}</p>
      )}
      {root}
    </div>
  );
}

/** The components written so far that parse: the last one may still be half written. */
function completeOf(components: unknown): A2uiComponent[] {
  if (!Array.isArray(components)) return [];
  return components.flatMap((raw: unknown) => {
    const result = A2uiComponentSchema.safeParse(raw);
    return result.success ? [result.data] : [];
  });
}

/** `seen`: a list being written may name itself among its children; it is drawn once. */
function renderNode(id: string, context: Context, seen: Set<string>): ReactNode {
  const component = context.byId.get(id);
  if (!component || seen.has(id)) return null;
  if (context.hideInputs && INPUTS[component.component]) return null;
  const inner = new Set(seen).add(id);
  const children = (ids: string[]) =>
    ids.map((child) => <Fragment key={child}>{renderNode(child, context, inner)}</Fragment>);

  switch (component.component) {
    case 'Column':
      return <div className='flex min-w-0 flex-col gap-2.5'>{children(component.children)}</div>;
    case 'Row':
      return <div className='flex min-w-0 flex-wrap items-center gap-2'>{children(component.children)}</div>;
    case 'Card':
      return (
        <Card size='sm' className='min-w-0'>
          <CardContent>{children([component.child])}</CardContent>
        </Card>
      );
    case 'Text':
      return <SurfaceText component={component} />;
    case 'Badge':
      return (
        <Badge variant='secondary' className='h-auto whitespace-normal'>
          {component.text}
        </Badge>
      );
    case 'Divider':
      return <Separator />;
    case 'Table':
      return <SurfaceTable component={component} />;
    case 'Image':
      return (
        <img
          src={component.url}
          alt={component.alt ?? ''}
          loading='lazy'
          className='max-h-80 max-w-full rounded-lg object-contain'
        />
      );
    case 'Checklist':
      return <Checklist component={component} context={context} />;
    case 'ChoiceChips':
      return <ChoiceChips component={component} context={context} />;
    case 'TextField':
      return <TextField component={component} context={context} />;
    case 'Button':
      return <SurfaceButton component={component} context={context} />;
    case 'ToolStatus':
      return <ToolStatus component={component} />;
    case 'Sources':
      return <Sources component={component} />;
  }
}

/** Plain text with **bold** only: never Markdown nor HTML. */
function SurfaceText({ component }: { component: A2uiComponentOf<'Text'> }) {
  const pieces = component.text.split(/\*\*(.+?)\*\*/g);
  const content = pieces.map((piece, index) =>
    // Odd pieces are what stood between the stars.
    index % 2 === 1 ? <strong key={index}>{piece}</strong> : piece,
  );
  if (component.variant === 'heading') {
    return <p className='font-heading text-base font-semibold whitespace-pre-wrap'>{content}</p>;
  }
  if (component.variant === 'caption') {
    return <p className='text-muted-foreground text-xs whitespace-pre-wrap'>{content}</p>;
  }
  return <p className='text-[15px] leading-relaxed whitespace-pre-wrap'>{content}</p>;
}

/** Wider than a phone, it scrolls sideways in its frame instead of widening the answer. */
function SurfaceTable({ component }: { component: A2uiComponentOf<'Table'> }) {
  return (
    <div className='bg-background max-w-full overflow-x-auto rounded-lg border'>
      <table className='w-full text-sm'>
        <thead>
          <tr className='border-b'>
            {component.header.map((cell, index) => (
              <th key={index} scope='col' className='px-3 py-2 text-left font-medium whitespace-nowrap'>
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {component.rows.map((cells, row) => (
            <tr key={row} className='border-b last:border-0'>
              {cells.map((cell, index) => (
                <td key={index} className='px-3 py-2 align-top'>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function objectOf(value: JsonValue): { [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {};
}

/** Ticked items are kept in an object bound to the data model: item id → `true`. */
function Checklist({ component, context }: { component: A2uiComponentOf<'Checklist'>; context: Context }) {
  const pointer = component.checked['@path'];
  const checked = objectOf(readPath(context.dataModel, pointer));
  const { onChange } = context;

  return (
    <ul className='grid gap-0.5'>
      {component.items.map((item) => {
        const ticked = checked[item.id] === true;
        return (
          <li key={item.id}>
            <label
              className={cn(
                'flex min-h-10 items-start gap-3 rounded-md px-1 py-2 text-[15px] leading-snug',
                onChange && 'hover:bg-background/60 cursor-pointer',
              )}
            >
              <input
                type='checkbox'
                checked={ticked}
                disabled={!onChange}
                onChange={(event) => {
                  const next = { ...checked };
                  if (event.target.checked) {
                    next[item.id] = true;
                  } else {
                    delete next[item.id];
                  }
                  onChange?.(writePath(context.dataModel, pointer, next));
                }}
                className='accent-primary focus-visible:ring-ring/50 mt-0.5 size-4.5 shrink-0 rounded outline-none focus-visible:ring-3 disabled:opacity-100'
              />
              <span className={cn('min-w-0 wrap-break-word', ticked && 'text-muted-foreground line-through')}>
                {item.label}
              </span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}

/** One choice (a string) or several (an array), bound to the data model. */
function ChoiceChips({ component, context }: { component: A2uiComponentOf<'ChoiceChips'>; context: Context }) {
  const pointer = component.value['@path'];
  const value = readPath(context.dataModel, pointer);
  const chosen = Array.isArray(value) ? value : [value];
  const { onChange } = context;

  const choose = (option: string) => {
    if (!component.multiple) {
      onChange?.(writePath(context.dataModel, pointer, option));
      return;
    }
    const next = chosen.includes(option)
      ? chosen.filter((item) => item !== option)
      : [...chosen.filter((item) => typeof item === 'string'), option];
    onChange?.(writePath(context.dataModel, pointer, next));
  };

  return (
    <div role='group' className='flex flex-wrap gap-2'>
      {component.options.map((option) => {
        const selected = chosen.includes(option.value);
        return (
          <Button
            key={option.value}
            type='button'
            variant={selected ? 'default' : 'outline'}
            size='sm'
            aria-pressed={selected}
            disabled={!onChange}
            onClick={() => choose(option.value)}
            className={cn(
              'h-auto min-h-9 rounded-full py-1.5 text-left whitespace-normal disabled:opacity-100',
              !selected && 'bg-background',
            )}
          >
            {selected && component.multiple && <Check />}
            {option.label}
          </Button>
        );
      })}
    </div>
  );
}

function TextField({ component, context }: { component: A2uiComponentOf<'TextField'>; context: Context }) {
  const id = useId();
  const pointer = component.value['@path'];
  const value = readPath(context.dataModel, pointer);
  const { onChange } = context;

  return (
    <div className='grid gap-1.5'>
      {component.label && <Label htmlFor={id}>{component.label}</Label>}
      <Input
        id={id}
        value={typeof value === 'string' ? value : ''}
        placeholder={component.placeholder}
        aria-label={component.label ? undefined : component.placeholder}
        disabled={!onChange}
        onChange={(event) => onChange?.(writePath(context.dataModel, pointer, event.target.value))}
        className='bg-background h-10'
      />
    </div>
  );
}

/** An event answers the question, with its context read from the data model; a message is sent as the user's. */
function SurfaceButton({ component, context }: { component: A2uiComponentOf<'Button'>; context: Context }) {
  const { onAction, onSend, dataModel } = context;
  const event = component.action?.event;
  let press: (() => void) | null = null;
  if (event && onAction) {
    press = () => onAction({ name: event.name, context: objectOf(resolveBindings(event.context ?? {}, dataModel)) });
  } else if (component.message && onSend) {
    const { message } = component;
    press = () => onSend(message);
  }

  return (
    <Button
      type='button'
      variant={component.variant === 'secondary' ? 'outline' : 'default'}
      disabled={!press}
      onClick={press ?? undefined}
      className={cn('h-auto min-h-9 whitespace-normal', component.variant === 'secondary' && 'bg-background')}
    >
      {component.label}
    </Button>
  );
}

/** A tool the model used: pulsing while it runs, its link once done. */
function ToolStatus({ component }: { component: A2uiComponentOf<'ToolStatus'> }) {
  const running = component.state === 'running';
  const Icon = ICONS[component.icon];
  return (
    <div className={cn('text-muted-foreground flex items-start gap-1.5 text-sm', running && 'animate-pulse')}>
      <Icon className={cn('mt-0.5 size-4 shrink-0', running && component.icon === 'loader' && 'animate-spin')} />
      <span className='min-w-0'>
        {component.link ? <SurfaceLink href={component.link}>{component.label}</SurfaceLink> : component.label}
      </span>
    </div>
  );
}

/** One of the app's pages opens in place; a file or another site opens in a new tab. */
function SurfaceLink({ href, children }: { href: string; children: ReactNode }) {
  const navigate = useNavigate();
  const appPage = href.startsWith('/') && !href.startsWith('//') && !href.startsWith('/api/');
  if (appPage) {
    return (
      <a
        href={href}
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
          event.preventDefault();
          void navigate({ href });
        }}
        className='hover:text-foreground'
      >
        {children}
      </a>
    );
  }
  return (
    <a href={href} target='_blank' rel='noreferrer' className='hover:text-foreground'>
      {children}
    </a>
  );
}

/** The sites a search read, as links: their names, their page titles on hover. */
function Sources({ component }: { component: A2uiComponentOf<'Sources'> }) {
  if (component.links.length === 0) return null;
  return (
    <ul className='flex flex-wrap gap-1.5'>
      {component.links.map((link) => (
        <li key={link.url}>
          <a
            href={link.url}
            target='_blank'
            rel='noreferrer'
            title={link.title}
            className='bg-background text-muted-foreground hover:text-foreground block max-w-48 truncate rounded-full border px-2.5 py-0.5 text-xs'
          >
            {siteOf(link.url)}
          </a>
        </li>
      ))}
    </ul>
  );
}
