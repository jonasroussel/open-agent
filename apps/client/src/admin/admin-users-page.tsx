import {
  API_ROUTES,
  apiPath,
  MAX_MONTHLY_QUOTA_USD,
  normalizeEmail,
  type AdminUserDto,
  type InviteUserResponse,
  type ListAdminUsersResponse,
  type ListMemoryRulesResponse,
  type UpdateAdminUserBody,
} from '@open-agent/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BookmarkCheck, Gauge, MoreHorizontal, Send, Trash2, UserX } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { sessionQuery } from '@/auth/session.ts';
import { AlertMessage } from '@/components/alert-message.tsx';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog.tsx';
import { Avatar, AvatarFallback } from '@/components/ui/avatar.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Label } from '@/components/ui/label.tsx';
import { currentLocale, i18n } from '@/i18n/i18n.ts';
import { api, apiOrThrow } from '@/lib/api.ts';
import { usePageTitle } from '@/shell/page-title.tsx';

const usersQueryKey = [API_ROUTES.adminUsers];

const STATUS_VARIANT = { invited: 'outline', active: 'secondary', revoked: 'destructive' } as const;

export function AdminUsersPage() {
  const { t } = useTranslation();
  usePageTitle(t('app.people'));
  const queryClient = useQueryClient();
  const { data: me } = useQuery(sessionQuery);
  const users = useQuery({
    queryKey: usersQueryKey,
    queryFn: async () => (await apiOrThrow<ListAdminUsersResponse>(API_ROUTES.adminUsers)).users,
  });
  const [email, setEmail] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [toRevoke, setToRevoke] = useState<AdminUserDto | null>(null);
  const [quotaOf, setQuotaOf] = useState<AdminUserDto | null>(null);
  const [memoryOf, setMemoryOf] = useState<AdminUserDto | null>(null);

  async function invite(address: string) {
    setPending(true);
    const result = await api<InviteUserResponse>(API_ROUTES.adminUsers, {
      method: 'POST',
      body: { email: address, locale: currentLocale() },
    });
    setPending(false);
    await queryClient.invalidateQueries({ queryKey: usersQueryKey });
    if (!result.ok) {
      setNotice(null);
      return setError(t(`errors.${result.error}`));
    }
    setError(null);
    setNotice(t('admin.invited', { email: result.data.user.email }));
    setEmail('');
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const address = normalizeEmail(email);
    if (!address) return setError(t('signIn.invalidEmail'));
    await invite(address);
  }

  async function revoke(user: AdminUserDto) {
    const result = await api(apiPath(API_ROUTES.adminUser, { userId: user.id }), { method: 'DELETE' });
    await queryClient.invalidateQueries({ queryKey: usersQueryKey });
    setNotice(null);
    setError(result.ok ? null : t(`errors.${result.error}`));
  }

  const dateFormat = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' });
  const money = moneyFormat(i18n.language);

  return (
    <div className='mx-auto grid w-full max-w-3xl gap-6 px-4 pt-6 pb-12 md:px-8'>
      <p className='text-muted-foreground'>{t('admin.description')}</p>

      <form onSubmit={submit} className='grid gap-3' noValidate>
        <div className='flex gap-2'>
          <Input
            type='email'
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder={t('admin.invitePlaceholder')}
            aria-label={t('admin.invitePlaceholder')}
            autoComplete='off'
            className='h-10 px-3 text-base'
          />
          <Button type='submit' size='lg' disabled={pending}>
            <Send />
            {pending ? t('admin.inviting') : t('admin.invite')}
          </Button>
        </div>
        {error && <AlertMessage text={error} />}
        {notice && (
          <p role='status' className='text-muted-foreground text-sm'>
            {notice}
          </p>
        )}
      </form>

      {users.isError && <AlertMessage text={t('errors.network')} />}
      <ul className='divide-y rounded-lg border'>
        {users.data?.map((user) => {
          const isMe = user.id === me?.id;
          return (
            <li key={user.id} className='hover:bg-muted/60 flex items-center gap-3 px-4 py-3'>
              <Avatar className='size-10'>
                <AvatarFallback className='bg-secondary text-secondary-foreground font-semibold'>
                  {user.email[0]!.toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className='grid min-w-0 flex-1 gap-1'>
                <div className='flex flex-wrap items-center gap-x-2 gap-y-1'>
                  <span className='min-w-0 truncate font-medium'>{user.email}</span>
                  {isMe && <span className='text-muted-foreground text-sm'>({t('admin.you')})</span>}
                  {user.role === 'admin' && <Badge>{t('admin.adminBadge')}</Badge>}
                  {user.ownKey && <Badge variant='outline'>{t('admin.ownKeyBadge')}</Badge>}
                  <Badge variant={STATUS_VARIANT[user.status]}>{t(`admin.status.${user.status}`)}</Badge>
                </div>
                <span className='text-muted-foreground text-sm'>
                  {user.lastSignInAt
                    ? t('admin.lastSignIn', { date: dateFormat.format(new Date(user.lastSignInAt)) })
                    : t('admin.neverSignedIn')}
                </span>
                <span className='text-muted-foreground text-sm'>
                  {user.monthlyQuotaUsd === null
                    ? t('admin.monthCostUnlimited', { cost: money(user.monthCostUsd) })
                    : t('admin.monthCost', { cost: money(user.monthCostUsd), quota: money(user.monthlyQuotaUsd) })}
                </span>
              </div>
              {isMe ? (
                <span className='size-9' />
              ) : (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant='ghost' size='icon' aria-label={t('admin.actions', { email: user.email })}>
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align='end' className='w-auto min-w-48'>
                    <DropdownMenuItem onSelect={() => setMemoryOf(user)}>
                      <BookmarkCheck />
                      {t('admin.seeMemory')}
                    </DropdownMenuItem>
                    {user.monthlyQuotaUsd !== null && (
                      <DropdownMenuItem onSelect={() => setQuotaOf(user)}>
                        <Gauge />
                        {t('admin.setQuota')}
                      </DropdownMenuItem>
                    )}
                    {user.status !== 'active' && (
                      <DropdownMenuItem onSelect={() => void invite(user.email)}>
                        <Send />
                        {t('admin.reinvite')}
                      </DropdownMenuItem>
                    )}
                    {user.status !== 'revoked' && (
                      <DropdownMenuItem variant='destructive' onSelect={() => setToRevoke(user)}>
                        <UserX />
                        {t('admin.revoke')}
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </li>
          );
        })}
      </ul>

      <AlertDialog open={toRevoke !== null} onOpenChange={(open) => !open && setToRevoke(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('admin.revokeTitle', { email: toRevoke?.email })}</AlertDialogTitle>
            <AlertDialogDescription>{t('admin.revokeDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('admin.cancel')}</AlertDialogCancel>
            <AlertDialogAction variant='destructive' onClick={() => toRevoke && void revoke(toRevoke)}>
              {t('admin.revoke')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <QuotaDialog user={quotaOf} onClose={() => setQuotaOf(null)} />
      <MemoryDialog user={memoryOf} onClose={() => setMemoryOf(null)} />
    </div>
  );
}

/** Cents are enough to follow a budget; a few calls that cost less still show as spent. */
function moneyFormat(language: string): (usd: number) => string {
  const format = new Intl.NumberFormat(language, {
    style: 'currency',
    currency: 'USD',
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: 2,
  });
  return (usd) => (usd > 0 && usd < 0.01 ? `< ${format.format(0.01)}` : format.format(usd));
}

/** A person's rules, to understand a strange answer, and to forget one the assistant misunderstood. */
function MemoryDialog({ user, onClose }: { user: AdminUserDto | null; onClose: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const queryKey = [API_ROUTES.adminUserMemory, user?.id];
  const rules = useQuery({
    queryKey,
    queryFn: async () =>
      (await apiOrThrow<ListMemoryRulesResponse>(apiPath(API_ROUTES.adminUserMemory, { userId: user!.id }))).rules,
    enabled: user !== null,
  });

  async function forget(ruleId: number) {
    await api(apiPath(API_ROUTES.adminUserMemoryRule, { userId: user!.id, ruleId }), { method: 'DELETE' });
    await queryClient.invalidateQueries({ queryKey });
  }

  return (
    <Dialog open={user !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>{t('admin.memoryTitle', { email: user?.email })}</DialogTitle>
          <DialogDescription>{t('admin.memoryDescription')}</DialogDescription>
        </DialogHeader>
        {rules.data?.length === 0 && <p className='text-muted-foreground py-4 text-center'>{t('admin.memoryEmpty')}</p>}
        <ul className='-mx-1 grid max-h-96 gap-1 overflow-y-auto'>
          {rules.data?.map((rule) => (
            <li key={rule.id} className='hover:bg-muted/60 flex items-start gap-3 rounded-lg px-2 py-2'>
              <BookmarkCheck className='text-muted-foreground mt-0.5 size-4 shrink-0' />
              <span className='flex-1 text-sm'>{rule.text}</span>
              <Button
                variant='ghost'
                size='icon'
                className='size-7'
                aria-label={t('admin.forgetRule', { rule: rule.text })}
                title={t('memory.forget')}
                onClick={() => void forget(rule.id)}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

function QuotaDialog({ user, onClose }: { user: AdminUserDto | null; onClose: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  // French keyboards type a comma.
  const usd = Number(value.replace(',', '.'));
  const valid = value.trim() !== '' && Number.isFinite(usd) && usd >= 0 && usd <= MAX_MONTHLY_QUOTA_USD;

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!user || !valid) return;
    const result = await api(apiPath(API_ROUTES.adminUser, { userId: user.id }), {
      method: 'PATCH',
      body: { monthlyQuotaUsd: usd } satisfies UpdateAdminUserBody,
    });
    if (!result.ok) return setError(t(`errors.${result.error}`));
    await queryClient.invalidateQueries({ queryKey: usersQueryKey });
    onClose();
  }

  return (
    <Dialog open={user !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        onOpenAutoFocus={() => {
          setValue(String(user?.monthlyQuotaUsd ?? ''));
          setError(null);
        }}
        className='sm:max-w-md'
      >
        <form onSubmit={save} className='grid gap-4'>
          <DialogHeader>
            <DialogTitle>{t('admin.quotaTitle', { email: user?.email })}</DialogTitle>
            <DialogDescription>{t('admin.quotaDescription')}</DialogDescription>
          </DialogHeader>
          <div className='grid gap-2'>
            <Label htmlFor='monthly-quota'>{t('admin.quotaLabel')}</Label>
            <Input
              id='monthly-quota'
              inputMode='decimal'
              value={value}
              onChange={(event) => setValue(event.target.value)}
              autoFocus
            />
          </div>
          {error && <AlertMessage text={error} />}
          <DialogFooter>
            <Button type='button' variant='outline' onClick={onClose}>
              {t('admin.cancel')}
            </Button>
            <Button type='submit' disabled={!valid}>
              {t('admin.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
