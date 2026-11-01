import { API_ROUTES, isLocale, type InviteUserResponse, type ListAdminUsersResponse } from '@open-agent/shared';
import type { BunRequest } from 'bun';

import type { Quotas } from '../../application/quotas.ts';
import type { UserAccess } from '../../application/user-access.ts';
import type { User } from '../../domain/user.ts';
import { error, readJson } from './http.ts';
import { toAdminUserDto } from './presenters.ts';

export type AdminHttpDependencies = {
  signedInUser: (request: BunRequest) => Promise<User | null>;
  userAccess: UserAccess;
  quotas: Quotas;
};

export function createAdminRoutes({ signedInUser, userAccess, quotas }: AdminHttpDependencies) {
  /** Checked on every request: a revoked or demoted admin loses the panel at once. */
  const withAdmin = async (request: BunRequest, handle: (admin: User) => Promise<Response>) => {
    const user = await signedInUser(request);
    if (!user) return error('not_signed_in', 401);
    if (user.role !== 'admin') return error('not_admin', 403);
    return handle(user);
  };
  const adminUserDto = async (user: User) => toAdminUserDto(user, await quotas.of(user));

  return {
    [API_ROUTES.adminUsers]: {
      GET: (request: BunRequest) =>
        withAdmin(request, async () => {
          const users = await userAccess.list();
          const quotaOf = await quotas.ofEveryone(users);
          return Response.json({
            users: users.map((user) => toAdminUserDto(user, quotaOf.get(user.id)!)),
          } satisfies ListAdminUsersResponse);
        }),
      POST: (request: BunRequest) =>
        withAdmin(request, async (admin) => {
          const body = await readJson(request);
          if (typeof body?.email !== 'string' || !isLocale(body.locale)) return error('invalid_request', 400);
          const result = await userAccess.invite(admin, body.email, body.locale);
          if (result.ok) return Response.json({ user: await adminUserDto(result.user) } satisfies InviteUserResponse);
          return error(result.reason, result.reason === 'email_failed' ? 502 : 400);
        }),
    },

    [API_ROUTES.adminUser]: {
      PATCH: (request: BunRequest<typeof API_ROUTES.adminUser>) =>
        withAdmin(request, async () => {
          const userId = Number(request.params.userId);
          if (!Number.isInteger(userId)) return error('not_found', 404);
          const body = await readJson(request);
          const result = await quotas.setLimit(userId, body?.monthlyQuotaUsd);
          if (!result.ok) return error(result.reason, result.reason === 'not_found' ? 404 : 400);
          return Response.json(await adminUserDto(result.user));
        }),
      DELETE: (request: BunRequest<typeof API_ROUTES.adminUser>) =>
        withAdmin(request, async (admin) => {
          const userId = Number(request.params.userId);
          if (!Number.isInteger(userId)) return error('not_found', 404);
          const result = await userAccess.revoke(admin, userId);
          if (result.ok) return new Response(null, { status: 204 });
          return error(result.reason, result.reason === 'not_found' ? 404 : 409);
        }),
    },
  };
}
