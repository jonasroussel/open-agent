import { API_ROUTES, LOCALES, type Locale, type SignedInUser } from '@open-agent/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { ChevronsUpDown, Languages, LogOut, Monitor, Moon, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { sessionQuery } from '@/auth/session.ts';
import { Avatar, AvatarFallback } from '@/components/ui/avatar.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.tsx';
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar.tsx';
import { currentLocale } from '@/i18n/i18n.ts';
import { api } from '@/lib/api.ts';
import { cn } from '@/lib/utils.ts';
import { quotaQuery } from '@/quota/quota-query.ts';
import { setTheme, THEMES, useTheme, type Theme } from '@/theme/theme.ts';

const LANGUAGE_NAMES: Record<Locale, string> = { fr: 'Français', en: 'English' };
const THEME_ICONS = { system: Monitor, light: Sun, dark: Moon } satisfies Record<Theme, unknown>;

export function UserMenu({ user }: { user: SignedInUser }) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const theme = useTheme();
  const ThemeIcon = THEME_ICONS[theme];
  const name = user.email.split('@')[0]!;
  const { data: quota } = useQuery(quotaQuery);

  async function signOut() {
    await api(API_ROUTES.session, { method: 'DELETE' });
    queryClient.setQueryData(sessionQuery.queryKey, null);
    await navigate({ to: '/sign-in' });
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size='lg' className='data-[state=open]:bg-sidebar-accent'>
              <Avatar className='size-8'>
                <AvatarFallback className='bg-primary text-primary-foreground font-semibold'>
                  {name[0]!.toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <span className='grid min-w-0 flex-1 text-left leading-tight'>
                <span className='truncate font-medium'>{name}</span>
                <span className='text-muted-foreground truncate text-xs'>{user.email}</span>
              </span>
              <ChevronsUpDown className='text-muted-foreground' />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent side='top' align='start' className='w-(--radix-dropdown-menu-trigger-width) min-w-56'>
            {quota && !quota.unlimited && (
              <>
                <div className='grid gap-1.5 px-2 py-1.5 text-sm'>
                  <span className='text-muted-foreground'>{t('quota.used', { percent: quota.percentUsed })}</span>
                  <div
                    role='progressbar'
                    aria-valuenow={quota.percentUsed}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    className='bg-muted h-1.5 overflow-hidden rounded-full'
                  >
                    <div
                      className={cn('h-full rounded-full', quota.exhausted ? 'bg-destructive' : 'bg-primary')}
                      style={{ width: `${quota.percentUsed}%` }}
                    />
                  </div>
                </div>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <ThemeIcon />
                {t('app.appearance')}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup value={theme} onValueChange={(value) => setTheme(value as Theme)}>
                  {THEMES.map((option) => {
                    const Icon = THEME_ICONS[option];
                    return (
                      <DropdownMenuRadioItem key={option} value={option}>
                        <Icon />
                        {t(`theme.${option}`)}
                      </DropdownMenuRadioItem>
                    );
                  })}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Languages />
                {t('app.language')}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup
                  value={currentLocale()}
                  onValueChange={(language) => void i18n.changeLanguage(language)}
                >
                  {LOCALES.map((locale) => (
                    <DropdownMenuRadioItem key={locale} value={locale}>
                      {LANGUAGE_NAMES[locale]}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void signOut()}>
              <LogOut />
              {t('app.signOut')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
