import type { Knex } from 'knex';

import * as usersAndSessions from './0001-users-and-sessions.ts';
import * as conversations from './0002-conversations.ts';
import * as memory from './0003-memory.ts';
import * as messagesKeyPerConversation from './0004-messages-key-per-conversation.ts';
import * as userQuota from './0005-user-quota.ts';
import * as conversationIcon from './0006-conversation-icon.ts';
import * as libraryFiles from './0007-library-files.ts';
import * as artifacts from './0008-artifacts.ts';
import * as settings from './0009-settings.ts';

/** Listed explicitly so migrations survive `bun build`. Append new ones at the end; never rename. */
const migrations: Record<string, Knex.Migration> = {
  '0001-users-and-sessions': usersAndSessions,
  '0002-conversations': conversations,
  '0003-memory': memory,
  '0004-messages-key-per-conversation': messagesKeyPerConversation,
  '0005-user-quota': userQuota,
  '0006-conversation-icon': conversationIcon,
  '0007-library-files': libraryFiles,
  '0008-artifacts': artifacts,
  '0009-settings': settings,
};

export const migrationSource: Knex.MigrationSource<string> = {
  getMigrations: async () => Object.keys(migrations),
  getMigrationName: (name) => name,
  getMigration: async (name) => migrations[name]!,
};
