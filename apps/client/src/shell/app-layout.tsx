import { MAX_CONVERSATION_TITLE_LENGTH } from '@open-agent/shared';
import { useQuery } from '@tanstack/react-query';
import { Outlet } from '@tanstack/react-router';
import { useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { sessionQuery } from '@/auth/session.ts';
import { SidebarInset, SidebarProvider, SidebarTrigger, useSidebar } from '@/components/ui/sidebar.tsx';
import { TooltipProvider } from '@/components/ui/tooltip.tsx';

import { AppSidebar } from './app-sidebar.tsx';
import { useChangeFeed } from './change-feed.ts';
import { PageTitleContext, type PageTitle } from './page-title.tsx';

/**
 * Every signed-in page, framed like Chatbox: the sidebar and the top bar sit on one grey background, and the page is
 * a white panel with a rounded top-left corner below the top bar. On a phone the sidebar is a drawer.
 */
export function AppLayout() {
  const { data: user } = useQuery(sessionQuery);
  const [title, setTitle] = useState<PageTitle | null>(null);
  useChangeFeed();
  // Signing out clears the session just before leaving for the sign-in page.
  if (!user) return null;

  return (
    <TooltipProvider>
      <SidebarProvider className='bg-sidebar'>
        <AppSidebar user={user} />
        <SidebarInset className='bg-sidebar h-dvh'>
          <TopBar title={title} />
          <div className='bg-background flex min-h-0 flex-1 flex-col overflow-y-auto md:rounded-tl-xl md:border-t md:border-l'>
            <PageTitleContext value={setTitle}>
              <Outlet />
            </PageTitleContext>
          </div>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}

/** The page's title, edited in place when the page allows it; the sidebar button shows when the sidebar is hidden. */
function TopBar({ title }: { title: PageTitle | null }) {
  const { open, isMobile } = useSidebar();

  return (
    <header className='flex h-12 shrink-0 items-center gap-2 px-3'>
      {(!open || isMobile) && <SidebarTrigger className='text-muted-foreground' />}
      {title?.rename ? (
        // Keyed by the title: another conversation, or a rename from elsewhere, starts a fresh field.
        <EditableTitle key={title.text} text={title.text} rename={title.rename} />
      ) : (
        title && <h1 className='truncate px-1 font-semibold'>{title.text}</h1>
      )}
    </header>
  );
}

/** A tap turns the title into a field: Enter or leaving it saves, Escape gives up. */
function EditableTitle({ text, rename }: { text: string; rename: (title: string) => Promise<void> }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<string | null>(null);
  // Escape closes the field, whose blur must then not save what was typed.
  const cancelled = useRef(false);

  function finish() {
    const title = draft?.trim();
    setDraft(null);
    if (!cancelled.current && title && title !== text) void rename(title);
    cancelled.current = false;
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') cancelled.current = true;
    if (event.key === 'Enter' || event.key === 'Escape') event.currentTarget.blur();
  }

  if (draft === null) {
    return (
      <h1 className='min-w-0'>
        <button
          type='button'
          onClick={() => setDraft(text)}
          title={t('conversations.renameTitle')}
          className='hover:bg-sidebar-accent block max-w-full cursor-text truncate rounded-md px-1 py-0.5 text-left font-semibold'
        >
          {text}
        </button>
      </h1>
    );
  }
  return (
    <input
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={finish}
      onKeyDown={onKeyDown}
      onFocus={(event) => event.currentTarget.select()}
      maxLength={MAX_CONVERSATION_TITLE_LENGTH}
      aria-label={t('conversations.renameTitle')}
      autoFocus
      className='bg-background focus-visible:ring-ring/50 w-full max-w-md min-w-0 rounded-md border px-1 py-0.5 font-semibold outline-none focus-visible:ring-3'
    />
  );
}
