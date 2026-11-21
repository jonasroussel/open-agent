import type { ChatMessage } from '@open-agent/shared';
import { Link } from '@tanstack/react-router';
import {
  Calculator,
  CalendarDays,
  CloudSun,
  Download,
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

import { fileSize } from '@/files/file-details.ts';
import { cn } from '@/lib/utils.ts';

type Part = ChatMessage['parts'][number];

const CONTEXT_TOOLS = {
  'tool-search_conversations': true,
  'tool-read_conversation': true,
  'tool-list_files': true,
  'tool-read_file': true,
  'tool-read_web_page': true,
  'tool-download_file': true,
  'tool-read_attachment': true,
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

/** The site's name for a link: a malformed URL, saved as it came, shows as it is instead of breaking the page. */
export function siteOf(url: string | undefined): string {
  try {
    return url ? new URL(url).hostname.replace(/^www\./, '') : '';
  } catch {
    return url ?? '';
  }
}

/** A link's file name, decoded: what a download that failed shows, having no name from the server. */
function fileNameOf(url: string): string {
  try {
    const segment = new URL(url).pathname.split('/').findLast(Boolean);
    return segment ? decodeURIComponent(segment) : siteOf(url);
  } catch {
    return url;
  }
}

/** What a line says, with its icon and where it leads; `running` while the tool works. */
type Line = { icon: LucideIcon; label: string; target?: ReactNode };

/**
 * One lookup the model made before answering: what it read or computed, so the user knows where the answer comes
 * from. It pulses while it runs; a failed one says so (the model was told why).
 */
export function ContextToolLine({ part }: { part: ContextToolPart }) {
  const { t, i18n } = useTranslation();
  const running = part.state === 'input-streaming' || part.state === 'input-available';
  const failed = part.state === 'output-error';
  const line = lineOf(part, running, t, i18n.language);

  return (
    <div className={cn('text-muted-foreground flex items-start gap-1.5 text-sm', running && 'animate-pulse')}>
      <line.icon className='mt-0.5 size-4 shrink-0' />
      <span className='min-w-0'>{failed ? t('tools.failed', { what: line.label }) : (line.target ?? line.label)}</span>
    </div>
  );
}

function lineOf(
  part: ContextToolPart,
  running: boolean,
  t: ReturnType<typeof useTranslation>['t'],
  language: string,
): Line {
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
    case 'tool-download_file': {
      if (part.state === 'output-error' && part.input?.url) {
        return { icon: Download, label: t('tools.downloadFile', { name: fileNameOf(part.input.url) }) };
      }
      if (!done) return { icon: Download, label: t('tools.downloadingFile') };
      const label = t('tools.downloadedFile', { name: part.output.name, size: fileSize(part.output.size, language) });
      return {
        icon: Download,
        label,
        target: (
          <a href={part.output.url} target='_blank' rel='noreferrer' className='hover:text-foreground'>
            {label}
          </a>
        ),
      };
    }
    case 'tool-read_attachment': {
      if (!done) return { icon: FileText, label: t('tools.readingAttachment') };
      const label = t('tools.readAttachment', { name: part.output.name });
      return {
        icon: FileText,
        label,
        target: (
          <a href={`/api/files/${part.output.id}`} target='_blank' rel='noreferrer' className='hover:text-foreground'>
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
