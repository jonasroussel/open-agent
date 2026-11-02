import { API_ROUTES, normalizeEmail, SIGN_IN_CODE_LENGTH, type SessionResponse } from '@open-agent/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { REGEXP_ONLY_DIGITS } from 'input-otp';
import { ArrowLeft, Mail } from 'lucide-react';
import { Fragment, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { AlertMessage } from '@/components/alert-message.tsx';
import { Button } from '@/components/ui/button.tsx';
import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from '@/components/ui/input-otp.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Label } from '@/components/ui/label.tsx';
import { currentLocale } from '@/i18n/i18n.ts';
import { api } from '@/lib/api.ts';

import { AuthFrame } from './auth-frame.tsx';
import { sessionQuery } from './session.ts';

/** Two groups of three boxes, read like the code in the email. */
const CODE_GROUPS = [0, 1].map((group) =>
  Array.from({ length: SIGN_IN_CODE_LENGTH / 2 }, (_, slot) => group * (SIGN_IN_CODE_LENGTH / 2) + slot),
);

/**
 * Two steps: the address, then the emailed code. The emailed link signs in too (`VerifyLinkPage`); the code is for
 * the app installed on an iPhone, which never receives the link: iOS opens it in Safari.
 */
export function SignInPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function requestEmail(event?: FormEvent) {
    event?.preventDefault();
    const address = email.trim();
    if (!normalizeEmail(address)) return setMessage(t('signIn.invalidEmail'));
    setPending(true);
    const result = await api(API_ROUTES.signInRequests, {
      method: 'POST',
      body: { email: address, locale: currentLocale() },
    });
    setPending(false);
    if (!result.ok) return setMessage(t(`errors.${result.error}`));
    setMessage(null);
    setSentTo(address);
  }

  /** Runs as soon as the last digit is typed or a code is pasted; the button is there for a retry. */
  async function signInWithCode(value: string) {
    setPending(true);
    const result = await api<SessionResponse>(API_ROUTES.signInWithCode, {
      method: 'POST',
      body: { email: sentTo, code: value },
    });
    setPending(false);
    if (!result.ok) {
      setCode('');
      return setMessage(t(`errors.${result.error}`));
    }
    queryClient.setQueryData(sessionQuery.queryKey, result.data.user);
    await navigate({ to: '/' });
  }

  function submitCode(event: FormEvent) {
    event.preventDefault();
    void signInWithCode(code);
  }

  if (!sentTo) {
    return (
      <AuthFrame>
        <form onSubmit={requestEmail} className='grid gap-6' noValidate>
          <div className='grid gap-2'>
            <h1 className='text-2xl font-semibold tracking-tight'>{t('signIn.title')}</h1>
            <p className='text-muted-foreground'>{t('signIn.description')}</p>
          </div>
          <div className='grid gap-2'>
            <Label htmlFor='sign-in-email'>{t('signIn.email')}</Label>
            <Input
              id='sign-in-email'
              type='email'
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder={t('signIn.emailPlaceholder')}
              autoComplete='email'
              className='h-11 px-4 text-base'
              autoFocus
            />
          </div>
          {message && <AlertMessage text={message} />}
          <Button type='submit' size='lg' className='h-11 text-base' disabled={pending}>
            <Mail />
            {pending ? t('signIn.sending') : t('signIn.send')}
          </Button>
        </form>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame>
      <form onSubmit={submitCode} className='grid gap-6' noValidate>
        <div className='grid gap-2'>
          <h1 className='text-2xl font-semibold tracking-tight'>{t('signIn.sentTitle')}</h1>
          <p className='text-muted-foreground'>
            {t('signIn.sentDescription', { email: sentTo, length: SIGN_IN_CODE_LENGTH })}
          </p>
        </div>
        <div className='grid gap-2'>
          <Label htmlFor='sign-in-code'>{t('signIn.code')}</Label>
          <InputOTP
            id='sign-in-code'
            maxLength={SIGN_IN_CODE_LENGTH}
            pattern={REGEXP_ONLY_DIGITS}
            value={code}
            onChange={setCode}
            onComplete={(value: string) => void signInWithCode(value)}
            inputMode='numeric'
            autoComplete='one-time-code'
            disabled={pending}
            // Slots shrink on a narrow phone instead of pushing the card wider than the screen.
            containerClassName='w-full justify-center gap-3'
            autoFocus
          >
            {CODE_GROUPS.map((slots, group) => (
              <Fragment key={slots[0]}>
                {group > 0 && <InputOTPSeparator />}
                <InputOTPGroup className='max-w-36 min-w-0 flex-1'>
                  {slots.map((index) => (
                    <InputOTPSlot key={index} index={index} className='h-12 min-w-0 flex-1 text-xl font-semibold' />
                  ))}
                </InputOTPGroup>
              </Fragment>
            ))}
          </InputOTP>
        </div>
        {message && <AlertMessage text={message} />}
        <Button
          type='submit'
          size='lg'
          className='h-11 text-base'
          disabled={pending || code.length !== SIGN_IN_CODE_LENGTH}
        >
          {pending ? t('signIn.checking') : t('signIn.submitCode')}
        </Button>
        <p className='text-muted-foreground text-sm'>{t('signIn.notReceived')}</p>
        <div className='flex flex-wrap justify-between gap-2'>
          <Button
            type='button'
            variant='ghost'
            onClick={() => {
              setSentTo(null);
              setCode('');
              setMessage(null);
            }}
          >
            <ArrowLeft />
            {t('signIn.otherEmail')}
          </Button>
          <Button type='button' variant='ghost' disabled={pending} onClick={() => void requestEmail()}>
            {t('signIn.resend')}
          </Button>
        </div>
      </form>
    </AuthFrame>
  );
}
