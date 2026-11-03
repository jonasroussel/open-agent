import { API_ROUTES, MAX_SEARCH_LENGTH, type SearchResponse } from '@open-agent/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog.tsx';
import { SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar.tsx';
import { apiOrThrow } from '@/lib/api.ts';

import { ConversationIcon } from './conversation-icon.tsx';

/** Typing pauses this long before the server is asked: one search per word, not per letter. */
const TYPING_PAUSE_MS = 250;

/** "Search", in the sidebar and with ⌘K / Ctrl+K: finds a conversation by the words of its messages. */
export function SearchMenuItem({ onNavigate }: { onNavigate: () => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const toggle = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'k' || !(event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      setOpen((wasOpen) => !wasOpen);
    };
    window.addEventListener('keydown', toggle);
    return () => window.removeEventListener('keydown', toggle);
  }, []);

  return (
    <SidebarMenuItem>
      <SidebarMenuButton className='h-9' onClick={() => setOpen(true)}>
        <Search />
        {t('search.open')}
      </SidebarMenuButton>
      <Dialog open={open} onOpenChange={setOpen}>
        {open && (
          <SearchDialogContent
            onOpen={() => {
              setOpen(false);
              onNavigate();
            }}
          />
        )}
      </Dialog>
    </SidebarMenuItem>
  );
}

function SearchDialogContent({ onOpen }: { onOpen: () => void }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const typing = useRef<ReturnType<typeof setTimeout>>(undefined);
  const results = useQuery({
    queryKey: [API_ROUTES.search, query],
    queryFn: async () =>
      (await apiOrThrow<SearchResponse>(`${API_ROUTES.search}?q=${encodeURIComponent(query)}`)).results,
    enabled: query.trim() !== '',
    placeholderData: keepPreviousData,
  });
  const day = new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'short' });
  const shown = query.trim() ? (results.data ?? []) : [];

  function type(value: string) {
    setText(value);
    clearTimeout(typing.current);
    typing.current = setTimeout(() => setQuery(value), TYPING_PAUSE_MS);
  }

  function open(conversationId: string) {
    onOpen();
    void navigate({ to: '/c/$conversationId', params: { conversationId } });
  }

  return (
    <DialogContent showCloseButton={false} className='top-[15%] translate-y-0 gap-0 p-0 sm:max-w-xl'>
      <DialogTitle className='sr-only'>{t('search.open')}</DialogTitle>
      <form
        className='flex items-center gap-3 px-4'
        onSubmit={(event) => {
          event.preventDefault();
          if (shown[0]) open(shown[0].conversation.id);
        }}
      >
        <Search className='text-muted-foreground size-4 shrink-0' />
        <input
          autoFocus
          value={text}
          maxLength={MAX_SEARCH_LENGTH}
          onChange={(event) => type(event.target.value)}
          placeholder={t('search.placeholder')}
          aria-label={t('search.placeholder')}
          className='placeholder:text-muted-foreground h-12 flex-1 bg-transparent text-base outline-none'
        />
      </form>
      {shown.length > 0 && (
        <ul className='grid max-h-[60vh] gap-0.5 overflow-y-auto border-t p-2'>
          {shown.map(({ conversation, snippet }) => (
            <li key={conversation.id}>
              <button
                type='button'
                onClick={() => open(conversation.id)}
                className='hover:bg-muted focus-visible:bg-muted flex w-full gap-3 rounded-lg px-3 py-2 text-left outline-none [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0'
              >
                <ConversationIcon name={conversation.icon} />
                <span className='grid min-w-0 flex-1 gap-0.5'>
                  <span className='flex items-baseline gap-2'>
                    <span className='truncate text-sm font-medium'>
                      {conversation.title ?? t('conversations.untitled')}
                    </span>
                    <span className='text-muted-foreground ml-auto shrink-0 text-xs'>
                      {day.format(new Date(conversation.updatedAt))}
                    </span>
                  </span>
                  <span className='text-muted-foreground line-clamp-2 text-sm'>
                    {snippet.map((part, index) =>
                      part.match ? (
                        <mark key={index} className='bg-primary/15 text-foreground rounded-sm px-0.5'>
                          {part.text}
                        </mark>
                      ) : (
                        <span key={index}>{part.text}</span>
                      ),
                    )}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {query.trim() && results.data?.length === 0 && (
        <p className='text-muted-foreground border-t px-4 py-8 text-center text-sm'>{t('search.empty')}</p>
      )}
    </DialogContent>
  );
}
