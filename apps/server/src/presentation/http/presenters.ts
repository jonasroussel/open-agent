import {
  type ArtifactDto,
  type ArtifactVersionDto,
  API_ROUTES,
  apiPath,
  type AdminUserDto,
  type CommandDto,
  type ConversationDto,
  type InvitationDto,
  type LibraryFileDto,
  type MemoryRuleDto,
  type QuotaResponse,
  type SignedInUser,
} from '@open-agent/shared';

import type { ConversationView, Invitation } from '../../application/conversations.ts';
import type { Artifact, ArtifactVersion } from '../../domain/artifact.ts';
import type { Command } from '../../domain/command.ts';
import { previewOf, type LibraryFile } from '../../domain/library-file.ts';
import type { MemoryRule } from '../../domain/memory.ts';
import { isExhausted, percentUsed, type Quota } from '../../domain/quota.ts';
import { personOf, userStatus, type User } from '../../domain/user.ts';

export function toSignedInUser(user: User): SignedInUser {
  return { id: user.id, email: user.email, role: user.role };
}

export function toAdminUserDto(user: User, quota: Quota): AdminUserDto {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    status: userStatus(user),
    invitedAt: user.invitedAt.toISOString(),
    lastSignInAt: user.lastSignInAt?.toISOString() ?? null,
    monthCostUsd: quota.usedUsd,
    monthlyQuotaUsd: quota.limitUsd,
    ownKey: quota.ownKey,
  };
}

export function toQuotaResponse(quota: Quota): QuotaResponse {
  return {
    unlimited: quota.limitUsd === null || quota.ownKey,
    ownKey: quota.ownKey,
    percentUsed: percentUsed(quota),
    exhausted: isExhausted(quota),
    resetsAt: quota.resetsAt.toISOString(),
  };
}

export function toConversationDto({ conversation, pinned, sharing }: ConversationView): ConversationDto {
  return {
    id: conversation.id,
    title: conversation.title,
    icon: conversation.icon,
    pinned,
    updatedAt: conversation.updatedAt.toISOString(),
    sharing: sharing && {
      role: sharing.role,
      owner: personOf(sharing.owner),
      members: sharing.members.map(({ user, status }) => ({ person: personOf(user), status })),
    },
  };
}

export function toInvitationDto({ conversation, from, invitedAt }: Invitation): InvitationDto {
  return {
    id: conversation.id,
    title: conversation.title,
    icon: conversation.icon,
    from: personOf(from),
    invitedAt: invitedAt.toISOString(),
  };
}

export function toMemoryRuleDto(rule: MemoryRule): MemoryRuleDto {
  return { id: rule.id, text: rule.text, updatedAt: rule.updatedAt.toISOString() };
}

export function toCommandDto(command: Command): CommandDto {
  return {
    id: command.id,
    name: command.name,
    prompt: command.prompt,
    uses: command.uses,
    updatedAt: command.updatedAt.toISOString(),
  };
}

export function toLibraryFileDto(file: Omit<LibraryFile, 'content'>): LibraryFileDto {
  return {
    id: file.id,
    name: file.name,
    kind: file.kind,
    mediaType: file.mediaType,
    size: file.size,
    createdAt: file.createdAt.toISOString(),
    url: apiPath(API_ROUTES.file, { fileId: file.id }),
    previewUrl: previewOf(file) ? apiPath(API_ROUTES.filePreview, { fileId: file.id }) : null,
  };
}

export function toArtifactDto(artifact: Artifact): ArtifactDto {
  return {
    id: artifact.id,
    conversationId: artifact.conversationId,
    kind: artifact.kind,
    title: artifact.title,
    version: artifact.version,
    updatedAt: artifact.updatedAt.toISOString(),
  };
}

export function toArtifactVersionDto(version: Omit<ArtifactVersion, 'content'>): ArtifactVersionDto {
  return {
    number: version.number,
    author: version.author,
    createdAt: version.createdAt.toISOString(),
    restoredFrom: version.restoredFrom,
  };
}
