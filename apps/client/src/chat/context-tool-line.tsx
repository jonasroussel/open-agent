import type { ChatMessage } from '@open-agent/shared';
import { Link } from '@tanstack/react-router';
import {
  Calculator,
  CalendarDays,
  CloudSun,
  FileText,
  FolderOpen,
  Globe,
  MessagesSquare,
  Search,
  SquareSlash,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils.ts';

type Part = ChatMessage['parts'][number];

const CONTEXT_TOOLS = {
  'tool-search_conversations': true,
  'tool-read_conversation': true,
  'tool-list_files': true,
  'tool-read_file': true,
  'tool-read_web_page': true,
  'tool-weather': true,
  'tool-calculate': true,
  'tool-days_between': true,
  'tool-date_plus_days': true,
  'tool-save_command': true,
} as const;

export type ContextToolPart = Extract<Part, { type: keyof typeof CONTEXT_TOOLS }>;

export function isContextToolPart(part: Part): part is ContextToolPart {
  return part.type in CONTEXT_TOOLS;
}

function siteOf(url: string | undefined): string {
  try {
    return url ? new URL(url).hostname.replace(/^www\./, '') : '';
  } catch {
    return url ?? '';
  }
}

/** What a line says, with its icon and where it leads; `running` while the tool works. */
type Line = { icon: LucideIcon; label: string; target?: ReactNode };

/**
 * One lookup the model made before answering: what it read or computed, so the user knows where the answer comes
 * from. It pulses while it runs; a failed one says so (the model was told why).
 */
export function ContextToolLine({ part }: { part: ContextToolPart }) {
  const { t } = useTranslation();
  const running = part.state === 'input-streaming' || part.state === 'input-available';
  const failed = part.state === 'output-error';
  const line = lineOf(part, running, t);

  return (
    <div className={cn('text-muted-foreground flex items-start gap-1.5 text-sm', running && 'animate-pulse')}>
      <line.icon className='mt-0.5 size-4 shrink-0' />
      <span className='min-w-0'>{failed ? t('tools.failed', { what: line.label }) : (line.target ?? line.label)}</span>
    </div>
  );
}

function lineOf(part: ContextToolPart, running: boolean, t: ReturnType<typeof useTranslation>['t']): Line {
  const done = part.state === 'output-available';
  switch (part.type) {
    case 'tool-search_conversations':
      return { icon: Search, label: t('tools.searchConversations', { query: part.input?.query ?? '' }) };
    case 'tool-read_conversation': {
      const title = done ? (part.output.title ?? t('conversations.untitled')) : '';
      if (!done) return { icon: MessagesSquare, label: t('tools.readingConversation') };
      return {
        icon: MessagesSquare,
        label: t('tools.readConversation', { title }),
        target: (
          <Link to='/c/$conversationId' params={{ conversationId: part.output.id }} className='hover:text-foreground'>
            {t('tools.readConversation', { title })}
          </Link>
        ),
      };
    }
    case 'tool-list_files':
      return { icon: FolderOpen, label: t('tools.listFiles') };
    case 'tool-read_file': {
      if (!done) return { icon: FileText, label: t('tools.readingFile') };
      return {
        icon: FileText,
        label: t('tools.readFile', { name: part.output.name }),
        target: (
          <a href={`/api/files/${part.output.id}`} target='_blank' rel='noreferrer' className='hover:text-foreground'>
            {t('tools.readFile', { name: part.output.name })}
          </a>
        ),
      };
    }
    case 'tool-read_web_page': {
      const url = done ? part.output.url : part.input?.url;
      const label = t(running ? 'tools.readingPage' : 'tools.readPage', { site: siteOf(url) });
      if (!url || running) return { icon: Globe, label };
      return {
        icon: Globe,
        label,
        target: (
          <a href={url} target='_blank' rel='noreferrer' className='hover:text-foreground'>
            {label}
          </a>
        ),
      };
    }
    case 'tool-weather':
      return {
        icon: CloudSun,
        label: t('tools.weather', { place: done ? part.output.place : (part.input?.place ?? '') }),
      };
    case 'tool-calculate':
      return {
        icon: Calculator,
        label: done
          ? t('tools.calculated', { expression: part.output.expression, result: part.output.result })
          : t('tools.calculating'),
      };
    case 'tool-days_between':
      return {
        icon: CalendarDays,
        label: done
          ? t('tools.daysBetween', { from: part.output.from, to: part.output.to, count: part.output.days })
          : t('tools.dates'),
      };
    case 'tool-date_plus_days':
      return {
        icon: CalendarDays,
        label: done
          ? t('tools.datePlusDays', { date: part.output.date, count: part.output.days, result: part.output.result })
          : t('tools.dates'),
      };
    case 'tool-save_command': {
      if (!done) return { icon: SquareSlash, label: t('commands.saving') };
      const label = t(part.output.created ? 'commands.created' : 'commands.updated', { name: part.output.name });
      return {
        icon: SquareSlash,
        label,
        target: (
          <Link to='/commands' className='hover:text-foreground'>
            {label}
          </Link>
        ),
      };
    }
  }
}
