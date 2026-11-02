import { useQuery } from '@tanstack/react-query';
import { Outlet } from '@tanstack/react-router';
import { useState } from 'react';

import { sessionQuery } from '@/auth/session.ts';
import { SidebarInset, SidebarProvider, SidebarTrigger, useSidebar } from '@/components/ui/sidebar.tsx';
import { TooltipProvider } from '@/components/ui/tooltip.tsx';

import { AppSidebar } from './app-sidebar.tsx';
import { useChangeFeed } from './change-feed.ts';
import { PageTitleContext } from './page-title.tsx';

/**
 * Every signed-in page, framed like Chatbox: the sidebar and the top bar sit on one grey background, and the page is
 * a white panel with a rounded top-left corner below the top bar. On a phone the sidebar is a drawer.
 */
export function AppLayout() {
  const { data: user } = useQuery(sessionQuery);
  const [title, setTitle] = useState<string | null>(null);
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

/** The page's title; the sidebar button shows when the sidebar is hidden. */
function TopBar({ title }: { title: string | null }) {
  const { open, isMobile } = useSidebar();

  return (
    <header className='flex h-12 shrink-0 items-center gap-2 px-3'>
      {(!open || isMobile) && <SidebarTrigger className='text-muted-foreground' />}
      {title && <h1 className='truncate px-1 font-semibold'>{title}</h1>}
    </header>
  );
}
