import { API_ROUTES, SIGN_IN_LINK_PATH, type SessionResponse } from '@open-agent/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { LoaderCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AlertMessage } from '@/components/alert-message.tsx';
import { Button } from '@/components/ui/button.tsx';
import { api } from '@/lib/api.ts';

import { AuthFrame } from './auth-frame.tsx';
import { sessionQuery } from './session.ts';

/**
 * The emailed link lands here; the token is posted from the page, never by the GET itself: mail scanners that open
 * links ahead of the person would otherwise use the one-time token up.
 */
export function VerifyLinkPage() {
  const { t } = useTranslation();
  const { token } = useSearch({ from: SIGN_IN_LINK_PATH });
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [failed, setFailed] = useState(false);
  // React's development double effect must not post the one-time token twice.
  const posted = useRef(false);

  useEffect(() => {
    if (posted.current) return;
    posted.current = true;
    void api<SessionResponse>(API_ROUTES.signInWithToken, { method: 'POST', body: { token } }).then(async (result) => {
      if (!result.ok) return setFailed(true);
      queryClient.setQueryData(sessionQuery.queryKey, result.data.user);
      await navigate({ to: '/', replace: true });
    });
  }, [token, queryClient, navigate]);

  return (
    <AuthFrame>
      {failed ? (
        <div className='grid gap-6'>
          <AlertMessage text={t('signIn.linkFailed')} />
          <Button size='lg' className='h-11 text-base' asChild>
            <Link to='/sign-in'>{t('signIn.backToSignIn')}</Link>
          </Button>
        </div>
      ) : (
        <p className='text-muted-foreground flex items-center justify-center gap-2 text-lg'>
          <LoaderCircle className='size-5 animate-spin' />
          {t('signIn.verifying')}
        </p>
      )}
    </AuthFrame>
  );
}
