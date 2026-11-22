import type { A2uiComponent, ChatMessage, Surface, ToolStatusIcon } from '@open-agent/shared';
import type { TFunction } from 'i18next';

import { fileSize } from '@/files/file-details.ts';

type Part = ChatMessage['parts'][number];

const TOOL_LINES = {
  'tool-web_search': true,
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

export type ToolLinePart = Extract<Part, { type: keyof typeof TOOL_LINES }>;

export function isToolLinePart(part: Part): part is ToolLinePart {
  return part.type in TOOL_LINES;
}

export function isRunning(part: Part & { state: string }): boolean {
  return part.state === 'input-streaming' || part.state === 'input-available';
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

type Line = { icon: ToolStatusIcon; label: string; link?: string; sources?: { url: string; title?: string }[] };

/** A status line, and the sites it read under it: one surface, drawn by the same renderer as the model's. */
export function statusSurface(line: Line, state: 'running' | 'done' | 'failed'): Surface {
  const status: A2uiComponent = {
    id: 'status',
    component: 'ToolStatus',
    icon: line.icon,
    label: line.label,
    state,
    ...(line.link ? { link: line.link } : {}),
  };
  if (!line.sources?.length) return { components: [{ ...status, id: 'root' }] };
  return {
    components: [
      { id: 'root', component: 'Column', children: ['status', 'sources'] },
      status,
      { id: 'sources', component: 'Sources', links: line.sources },
    ],
  };
}

/**
 * One lookup the model made before answering: what it read or computed, so the user knows where the answer comes
 * from. It pulses while it runs; a failed one says so (the model was told why).
 */
export function toolSurfaceOf(part: ToolLinePart, t: TFunction, language: string): Surface {
  const running = isRunning(part);
  const line = lineOf(part, running, t, language);
  if (part.state === 'output-error') {
    // The web search says so in its own words; a failed one has no link to follow.
    const label = part.type === 'tool-web_search' ? line.label : t('tools.failed', { what: line.label });
    return statusSurface({ icon: line.icon, label }, 'failed');
  }
  return statusSurface(line, running ? 'running' : 'done');
}

function lineOf(part: ToolLinePart, running: boolean, t: TFunction, language: string): Line {
  const done = part.state === 'output-available';
  switch (part.type) {
    case 'tool-web_search': {
      const query = part.input?.query ?? '';
      if (part.state === 'output-error') return { icon: 'globe', label: t('chat.searchFailed') };
      if (!done) return { icon: 'globe', label: t('chat.searching', { query }) };
      // One link per site.
      const sites = new Map<string, { url: string; title?: string }>();
      for (const result of part.output.results) {
        const site = siteOf(result.url);
        if (!sites.has(site)) sites.set(site, { url: result.url, title: result.title });
      }
      return { icon: 'globe', label: t('chat.searched', { query }), sources: [...sites.values()] };
    }
    case 'tool-search_conversations':
      return { icon: 'search', label: t('tools.searchConversations', { query: part.input?.query ?? '' }) };
    case 'tool-read_conversation': {
      if (!done) return { icon: 'messages', label: t('tools.readingConversation') };
      const title = part.output.title ?? t('conversations.untitled');
      return { icon: 'messages', label: t('tools.readConversation', { title }), link: `/c/${part.output.id}` };
    }
    case 'tool-list_files':
      return { icon: 'folder', label: t('tools.listFiles') };
    case 'tool-read_file':
      if (!done) return { icon: 'file', label: t('tools.readingFile') };
      return {
        icon: 'file',
        label: t('tools.readFile', { name: part.output.name }),
        link: `/api/files/${part.output.id}`,
      };
    case 'tool-read_web_page': {
      const url = done ? part.output.url : part.input?.url;
      const label = t(running ? 'tools.readingPage' : 'tools.readPage', { site: siteOf(url) });
      return url && !running ? { icon: 'globe', label, link: url } : { icon: 'globe', label };
    }
    case 'tool-download_file': {
      if (part.state === 'output-error' && part.input?.url) {
        return { icon: 'download', label: t('tools.downloadFile', { name: fileNameOf(part.input.url) }) };
      }
      if (!done) return { icon: 'download', label: t('tools.downloadingFile') };
      return {
        icon: 'download',
        label: t('tools.downloadedFile', { name: part.output.name, size: fileSize(part.output.size, language) }),
        link: part.output.url,
      };
    }
    case 'tool-read_attachment':
      if (!done) return { icon: 'file', label: t('tools.readingAttachment') };
      return {
        icon: 'file',
        label: t('tools.readAttachment', { name: part.output.name }),
        link: `/api/files/${part.output.id}`,
      };
    case 'tool-weather':
      return {
        icon: 'cloud-sun',
        label: t('tools.weather', { place: done ? part.output.place : (part.input?.place ?? '') }),
      };
    case 'tool-calculate':
      return {
        icon: 'calculator',
        label: done
          ? t('tools.calculated', { expression: part.output.expression, result: part.output.result })
          : t('tools.calculating'),
      };
    case 'tool-days_between':
      return {
        icon: 'calendar',
        label: done
          ? t('tools.daysBetween', { from: part.output.from, to: part.output.to, count: part.output.days })
          : t('tools.dates'),
      };
    case 'tool-date_plus_days':
      return {
        icon: 'calendar',
        label: done
          ? t('tools.datePlusDays', { date: part.output.date, count: part.output.days, result: part.output.result })
          : t('tools.dates'),
      };
    case 'tool-save_command':
      if (!done) return { icon: 'command', label: t('commands.saving') };
      return {
        icon: 'command',
        label: t(part.output.created ? 'commands.created' : 'commands.updated', { name: part.output.name }),
        link: '/commands',
      };
  }
}
