import { SIGN_IN_LINK_PATH } from '@open-agent/shared';
import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, createRoute, createRouter, Outlet, redirect } from '@tanstack/react-router';

import { AdminSettingsPage } from './admin/admin-settings-page.tsx';
import { AdminUsersPage } from './admin/admin-users-page.tsx';
import { sessionQuery } from './auth/session.ts';
import { SignInPage } from './auth/sign-in-page.tsx';
import { VerifyLinkPage } from './auth/verify-link-page.tsx';
import { ConversationPage } from './chat/conversation-page.tsx';
import { NewChatPage } from './chat/new-chat-page.tsx';
import { FilesPage } from './files/files-page.tsx';
import { queryClient } from './lib/query-client.ts';
import { MemoryPage } from './memory/memory-page.tsx';
import { RootError } from './root-error.tsx';
import { AppLayout } from './shell/app-layout.tsx';

const rootRoute = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: Outlet,
  errorComponent: RootError,
});

const signInRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sign-in',
  beforeLoad: async ({ context }) => {
    if (await context.queryClient.ensureQueryData(sessionQuery)) throw redirect({ to: '/' });
  },
  component: SignInPage,
});

const verifyLinkRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: SIGN_IN_LINK_PATH,
  validateSearch: (search): { token: string } => ({ token: typeof search.token === 'string' ? search.token : '' }),
  component: VerifyLinkPage,
});

/** Every page behind it needs a session. */
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  beforeLoad: async ({ context }) => {
    const user = await context.queryClient.ensureQueryData(sessionQuery);
    if (!user) throw redirect({ to: '/sign-in' });
    return { user };
  },
  component: AppLayout,
});

const newChatRoute = createRoute({ getParentRoute: () => appRoute, path: '/', component: NewChatPage });

const conversationRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/c/$conversationId',
  // `?doc=`: the canvas document open next to the conversation; back closes it.
  validateSearch: (search: Record<string, unknown>): { doc?: string } =>
    typeof search.doc === 'string' ? { doc: search.doc } : {},
  component: ConversationPage,
});

const memoryRoute = createRoute({ getParentRoute: () => appRoute, path: '/memory', component: MemoryPage });

const filesRoute = createRoute({ getParentRoute: () => appRoute, path: '/files', component: FilesPage });

const adminUsersRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/admin/users',
  beforeLoad: ({ context }) => {
    if (context.user.role !== 'admin') throw redirect({ to: '/' });
  },
  component: AdminUsersPage,
});

const adminSettingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/admin/settings',
  beforeLoad: ({ context }) => {
    if (context.user.role !== 'admin') throw redirect({ to: '/' });
  },
  component: AdminSettingsPage,
});

export const router = createRouter({
  routeTree: rootRoute.addChildren([
    signInRoute,
    verifyLinkRoute,
    appRoute.addChildren([
      newChatRoute,
      conversationRoute,
      memoryRoute,
      filesRoute,
      adminUsersRoute,
      adminSettingsRoute,
    ]),
  ]),
  context: { queryClient },
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
