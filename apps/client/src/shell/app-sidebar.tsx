import type { SignedInUser } from '@open-agent/shared';
import { Link, useMatchRoute } from '@tanstack/react-router';
import { BookmarkCheck, FolderOpen, SquarePen, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { BrandIcon } from '@/components/brand-icon.tsx';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar.tsx';

import { ConversationList } from './conversation-list.tsx';
import { UserMenu } from './user-menu.tsx';

export function AppSidebar({ user }: { user: SignedInUser }) {
  const { t } = useTranslation();
  const matchRoute = useMatchRoute();
  const { setOpenMobile } = useSidebar();
  // On a phone the sidebar is a drawer over the page: following a link closes it.
  const closeOnPhone = () => setOpenMobile(false);

  return (
    // No border: the sidebar and the top bar share one grey background, as in Chatbox.
    <Sidebar className='group-data-[side=left]:border-r-0'>
      <SidebarHeader className='h-12 flex-row items-center justify-between px-3 py-0'>
        <Link to='/' onClick={closeOnPhone} className='flex items-center gap-2 px-1 text-base font-semibold'>
          <BrandIcon className='size-6' />
          {t('app.name')}
        </Link>
        <SidebarTrigger className='text-muted-foreground' />
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu className='gap-1'>
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                size='lg'
                className='bg-secondary text-secondary-foreground hover:bg-secondary/80 hover:text-secondary-foreground h-10 font-medium'
              >
                <Link to='/' onClick={closeOnPhone}>
                  <SquarePen />
                  {t('app.newConversation')}
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton asChild className='h-9' isActive={Boolean(matchRoute({ to: '/memory' }))}>
                <Link to='/memory' onClick={closeOnPhone}>
                  <BookmarkCheck />
                  {t('memory.title')}
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton asChild className='h-9' isActive={Boolean(matchRoute({ to: '/files' }))}>
                <Link to='/files' onClick={closeOnPhone}>
                  <FolderOpen />
                  {t('files.title')}
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
            {user.role === 'admin' && (
              <SidebarMenuItem>
                <SidebarMenuButton asChild className='h-9' isActive={Boolean(matchRoute({ to: '/admin/users' }))}>
                  <Link to='/admin/users' onClick={closeOnPhone}>
                    <Users />
                    {t('app.people')}
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}
          </SidebarMenu>
        </SidebarGroup>

        <ConversationList onNavigate={closeOnPhone} />
      </SidebarContent>

      <SidebarFooter className='border-sidebar-border border-t'>
        <UserMenu user={user} />
      </SidebarFooter>
    </Sidebar>
  );
}
