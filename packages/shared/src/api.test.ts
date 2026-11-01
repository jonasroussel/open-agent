import { describe, expect, test } from 'bun:test';

import { apiPath } from './api.ts';

describe('apiPath', () => {
  test('fills every param and encodes it, so an id can never add a path segment', () => {
    expect(
      apiPath('/api/conversations/:conversationId/messages/:messageId', { conversationId: 'a/b c', messageId: 7 }),
    ).toBe('/api/conversations/a%2Fb%20c/messages/7');
  });
});
