import { describe, expect, test } from 'bun:test';

import type { ListAdminUsersResponse, SessionResponse } from '@open-agent/shared';

import {
  ADMIN,
  PUBLIC_URL,
  DEV_CODE,
  advanceMinutes,
  call,
  requestSignIn,
  tokenOf,
  sessionCookie,
  signIn,
  invite,
  errorOf,
  state,
  useApp,
} from './harness.ts';

useApp();

const adminCode = (code: string) => call('/api/sign-in/code', { method: 'POST', body: { email: ADMIN, code } });
const adminLocale = async () => (await state.database('users').where({ email: ADMIN }).first()).locale;

function inviteFrom(origin: string | null, cookie: string, email: string) {
  return fetch(new URL('/api/admin/users', state.server.url), {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie, ...(origin ? { origin } : {}) },
    body: JSON.stringify({ email, locale: 'fr' }),
  });
}

describe('sign-in by email', () => {
  test('the emailed link opens a session that lasts until sign-out', async () => {
    const cookie = await signIn('  Admin@Example.com ');

    expect(state.sent[0]!.link.startsWith(`${PUBLIC_URL}/sign-in/verify?token=`)).toBe(true);
    const session = (await (await call('/api/session', { cookie })).json()) as SessionResponse;
    expect(session.user).toMatchObject({ email: ADMIN, role: 'admin' });

    expect((await call('/api/session', { method: 'DELETE', cookie })).status).toBe(204);
    expect(await errorOf(await call('/api/session', { cookie }))).toBe('not_signed_in');
  });

  test('a link works once, and only for 15 minutes', async () => {
    await requestSignIn(ADMIN);
    const token = tokenOf(state.sent[0]!);
    expect((await call('/api/sign-in/token', { method: 'POST', body: { token } })).status).toBe(200);
    expect(await errorOf(await call('/api/sign-in/token', { method: 'POST', body: { token } }))).toBe(
      'invalid_sign_in',
    );

    await requestSignIn(ADMIN);
    advanceMinutes(16);
    const late = await call('/api/sign-in/token', { method: 'POST', body: { token: tokenOf(state.sent[1]!) } });
    expect(await errorOf(late)).toBe('invalid_sign_in');
  });

  test('the code from the same email signs in on a device that cannot open the link', async () => {
    await requestSignIn(ADMIN);
    const response = await call('/api/sign-in/code', {
      method: 'POST',
      body: { email: ADMIN, code: ` ${state.sent[0]!.code} ` },
    });
    expect(response.status).toBe(200);
    expect((await call('/api/session', { cookie: sessionCookie(response) })).status).toBe(200);
  });

  test('the development code signs in any invited user without an email, and never an uninvited one', async () => {
    const response = await call('/api/sign-in/code', { method: 'POST', body: { email: ADMIN, code: DEV_CODE } });
    expect(response.status).toBe(200);
    expect((await call('/api/session', { cookie: sessionCookie(response) })).status).toBe(200);

    const stranger = await call('/api/sign-in/code', {
      method: 'POST',
      body: { email: 'stranger@example.com', code: DEV_CODE },
    });
    expect(await errorOf(stranger)).toBe('invalid_sign_in');
  });

  test('wrong codes are blocked before a code can be guessed, even the right one', async () => {
    await requestSignIn(ADMIN);
    const wrong = state.sent[0]!.code === '000000' ? '111111' : '000000';
    for (let attempt = 0; attempt < 10; attempt++) {
      const response = await call('/api/sign-in/code', { method: 'POST', body: { email: ADMIN, code: wrong } });
      expect(await errorOf(response)).toBe('invalid_sign_in');
    }
    const right = await call('/api/sign-in/code', {
      method: 'POST',
      body: { email: ADMIN, code: state.sent[0]!.code },
    });
    expect(await errorOf(right)).toBe('too_many_attempts');
  });

  test('an address that is not invited gets the same answer, and no email', async () => {
    expect((await requestSignIn('stranger@example.com')).status).toBe(204);
    expect(state.sent).toHaveLength(0);
  });

  test('too many emails to one address are refused', async () => {
    for (let attempt = 0; attempt < 5; attempt++) expect((await requestSignIn(ADMIN)).status).toBe(204);
    expect(await errorOf(await requestSignIn(ADMIN))).toBe('too_many_attempts');
    expect(state.sent).toHaveLength(5);
  });

  test('an invited and an unknown address get the same answer, even when the email cannot be sent', async () => {
    state.mailerDown = true;
    const invited = await requestSignIn(ADMIN);
    const unknown = await requestSignIn('stranger@example.com');

    expect(invited.status).toBe(204);
    expect([unknown.status, await unknown.text()]).toEqual([invited.status, await invited.text()]);
  });

  test('a new email retires the code of the previous one', async () => {
    await requestSignIn(ADMIN);
    await requestSignIn(ADMIN);
    const [older, newer] = state.sent;

    expect(await errorOf(await adminCode(older!.code!))).toBe('invalid_sign_in');
    expect((await adminCode(newer!.code!)).status).toBe(200);
  });

  test('after 5 wrong codes even the right one is refused, before the per-address limit steps in', async () => {
    await requestSignIn(ADMIN);
    const right = state.sent[0]!.code!;
    const wrong = right === '000000' ? '111111' : '000000';
    for (let attempt = 0; attempt < 5; attempt++) {
      expect(await errorOf(await adminCode(wrong))).toBe('invalid_sign_in');
    }
    expect(await errorOf(await adminCode(right))).toBe('invalid_sign_in');
  });

  test("the form's language becomes the user's only once the code proves who they are", async () => {
    await call('/api/sign-in/requests', { method: 'POST', body: { email: ADMIN, locale: 'en' } });
    expect(state.sent[0]!.locale).toBe('en');
    expect(await adminLocale()).toBe('fr');

    expect((await adminCode(state.sent[0]!.code!)).status).toBe(200);
    expect(await adminLocale()).toBe('en');
  });
});

describe('requests from other sites', () => {
  test('a change sent from a page of another origin, even a sibling subdomain, is refused and changes nothing', async () => {
    const cookie = await signIn(ADMIN);

    expect((await inviteFrom('https://evil.example.com', cookie, 'eve@example.com')).status).toBe(403);
    expect(await state.database('users').where({ email: 'eve@example.com' })).toHaveLength(0);
    expect((await inviteFrom(PUBLIC_URL, cookie, 'eve@example.com')).status).toBe(200);
    expect((await inviteFrom(null, cookie, 'ana@example.com')).status).toBe(200);
  });
});

describe('invitations', () => {
  test('an invitation has a 7-day link without a code, and the invited person can then sign in alone', async () => {
    const adminCookie = await signIn(ADMIN);
    const { user } = await invite(adminCookie, 'Ana@Example.com');
    expect(user).toMatchObject({ email: 'ana@example.com', role: 'user', status: 'invited' });

    const invitation = state.sent.at(-1)!;
    expect(invitation).toMatchObject({ to: 'ana@example.com', kind: 'invitation', code: null, locale: 'en' });
    advanceMinutes(6 * 24 * 60);
    const response = await call('/api/sign-in/token', { method: 'POST', body: { token: tokenOf(invitation) } });
    expect(response.status).toBe(200);

    const list = (await (await call('/api/admin/users', { cookie: adminCookie })).json()) as ListAdminUsersResponse;
    expect(list.users.map((listed) => [listed.email, listed.status])).toEqual([
      [ADMIN, 'active'],
      ['ana@example.com', 'active'],
    ]);
  });

  test('a sign-in email leaves a pending invitation link working', async () => {
    const adminCookie = await signIn(ADMIN);
    await invite(adminCookie, 'ana@example.com');
    const invitation = state.sent.at(-1)!;
    await requestSignIn('ana@example.com');

    const response = await call('/api/sign-in/token', { method: 'POST', body: { token: tokenOf(invitation) } });
    expect(response.status).toBe(200);
  });

  test('only an admin sees and manages the users', async () => {
    const adminCookie = await signIn(ADMIN);
    await invite(adminCookie, 'ana@example.com');
    const anaCookie = await signIn('ana@example.com');

    expect(await errorOf(await call('/api/admin/users', { cookie: anaCookie }))).toBe('not_admin');
    expect(await errorOf(await call('/api/admin/users'))).toBe('not_signed_in');
    const inviting = await call('/api/admin/users', {
      method: 'POST',
      body: { email: 'eve@example.com', locale: 'fr' },
      cookie: anaCookie,
    });
    expect(await errorOf(inviting)).toBe('not_admin');
  });

  test('revoking ends every session at once and stops new sign-ins; inviting again restores the access', async () => {
    const adminCookie = await signIn(ADMIN);
    const { user } = await invite(adminCookie, 'ana@example.com');
    const anaCookie = await signIn('ana@example.com');
    await requestSignIn('ana@example.com');
    const pendingToken = tokenOf(state.sent.at(-1)!);

    expect((await call(`/api/admin/users/${user.id}`, { method: 'DELETE', cookie: adminCookie })).status).toBe(204);
    expect(await errorOf(await call('/api/session', { cookie: anaCookie }))).toBe('not_signed_in');
    const pending = await call('/api/sign-in/token', { method: 'POST', body: { token: pendingToken } });
    expect(await errorOf(pending)).toBe('invalid_sign_in');
    const emailsBefore = state.sent.length;
    await requestSignIn('ana@example.com');
    expect(state.sent).toHaveLength(emailsBefore);

    expect((await invite(adminCookie, 'ana@example.com')).user.status).toBe('active');
    await signIn('ana@example.com');
  });

  test('an admin cannot revoke themselves, so the app always keeps one', async () => {
    const adminCookie = await signIn(ADMIN);
    const session = (await (await call('/api/session', { cookie: adminCookie })).json()) as SessionResponse;
    const response = await call(`/api/admin/users/${session.user.id}`, { method: 'DELETE', cookie: adminCookie });
    expect(await errorOf(response)).toBe('cannot_revoke_self');
  });
});
