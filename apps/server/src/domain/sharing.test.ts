import { describe, expect, test } from 'bun:test';

import type { ChatMessage } from './conversation.ts';
import { continuedHistory, visibleTo } from './sharing.ts';

const OWNER = { id: 1, name: 'jonas', email: 'jonas@example.com' };
const MARIE = { id: 2, name: 'marie', email: 'marie@example.com' };

const user = (id: string, author = OWNER): ChatMessage => ({
  id,
  role: 'user',
  metadata: { author },
  parts: [{ type: 'text', text: id }],
});
const answer = (id: string): ChatMessage => ({ id, role: 'assistant', parts: [{ type: 'text', text: id }] });
const QUESTION = { question: 'Mer ?', options: [] };
/** The assistant's message asking one question: pending, or answered with `reply`. */
const asking = (id: string, reply?: string): ChatMessage => ({
  id,
  role: 'assistant',
  parts: [
    { type: 'text', text: 'Une question.' },
    reply === undefined
      ? { type: 'tool-ask_user', toolCallId: 'q1', state: 'input-available', input: QUESTION }
      : {
          type: 'tool-ask_user',
          toolCallId: 'q1',
          state: 'output-available',
          input: QUESTION,
          output: { answer: reply },
        },
  ],
});

describe('continuedHistory', () => {
  const saved = [user('u1'), answer('a1'), user('u2', MARIE), answer('a2')];

  test('a new message goes after the saved history, signed by its sender, whatever else the copy holds', () => {
    const forged = { ...user('u1'), parts: [{ type: 'text' as const, text: 'changed' }] };
    const result = continuedHistory(
      saved,
      [forged, answer('a1'), user('u2', MARIE), answer('a2'), user('u3', OWNER)],
      MARIE,
      1,
      true,
    );
    expect(result).toEqual({ ok: true, messages: [...saved, { ...user('u3', MARIE) }] });
  });

  test('a copy behind the saved history is refused: the message would erase what others wrote', () => {
    expect(continuedHistory(saved, [user('u1'), answer('a1'), user('u3')], OWNER, 1, true)).toEqual({
      ok: false,
      reason: 'conversation_changed',
    });
    expect(continuedHistory(saved, [user('u1'), answer('a1'), user('u3')], OWNER, 1, false)).toEqual({
      ok: false,
      reason: 'conversation_changed',
    });
  });

  test('only the sender may edit or answer again their last message', () => {
    expect(continuedHistory(saved, [user('u1'), answer('a1'), user('u2', MARIE)], MARIE, 1, true)).toEqual({
      ok: true,
      messages: [user('u1'), answer('a1'), user('u2', MARIE)],
    });
    expect(continuedHistory(saved, [user('u1'), answer('a1'), user('u2')], OWNER, 1, true)).toEqual({
      ok: false,
      reason: 'not_allowed',
    });
    // An older message would drop everything said after it.
    expect(continuedHistory(saved, [user('u1')], OWNER, 1, true)).toEqual({ ok: false, reason: 'not_allowed' });
  });

  test('alone in a conversation, the user may edit any of their messages, dropping everything after it', () => {
    const edited = { ...user('u1'), parts: [{ type: 'text' as const, text: 'changed' }] };
    expect(continuedHistory(saved, [edited], OWNER, 1, false)).toEqual({ ok: true, messages: [edited] });
    // Seen from a copy that misses a message before it, the edit is refused.
    expect(continuedHistory(saved, [user('u1'), user('u2')], OWNER, 1, false)).toEqual({
      ok: false,
      reason: 'conversation_changed',
    });
  });

  test('messages from before the sharing are the owner’s', () => {
    const old: ChatMessage = { id: 'u0', role: 'user', parts: [{ type: 'text', text: 'avant' }] };
    expect(continuedHistory([old, answer('a0')], [old], OWNER, 1, true)).toMatchObject({ ok: true });
    expect(continuedHistory([old, answer('a0')], [old], MARIE, 1, true)).toEqual({ ok: false, reason: 'not_allowed' });
  });

  test('answering the last questions keeps the saved answer, taking only the answers from the copy', () => {
    const history = [user('u1'), asking('a1')];
    const answered = asking('a1', 'Mer');
    const forged = { ...answered, parts: [{ type: 'text' as const, text: 'forged' }, ...answered.parts.slice(1)] };
    expect(continuedHistory(history, [user('u1'), forged], OWNER, 1, false)).toEqual({
      ok: true,
      messages: [user('u1'), answered],
    });
  });

  test('an answer without a pending question is refused: the copy cannot replace a finished answer', () => {
    const forged = { ...answer('a2'), parts: [{ type: 'text' as const, text: 'forged' }] };
    expect(continuedHistory(saved, [...saved.slice(0, -1), forged], OWNER, 1, false)).toEqual({
      ok: false,
      reason: 'conversation_changed',
    });
    const answered = [user('u1'), asking('a1', 'Mer')];
    expect(continuedHistory(answered, answered, OWNER, 1, false)).toEqual({
      ok: false,
      reason: 'conversation_changed',
    });
  });
});

const notice = (userId?: number) => ({
  type: 'data-memory' as const,
  id: `m${userId}`,
  data: { changeId: 1, operation: 'add' as const, before: null, after: 'Habite à Nantes.', undone: false, userId },
});

describe('visibleTo', () => {
  test("a memory notice shows only to the person whose memory changed; old notices are the owner's", () => {
    const messages: ChatMessage[] = [
      { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'ok' }, notice(2), notice(), notice(1)] },
    ];
    expect(visibleTo(messages, 2, 1)[0]!.parts.map((part) => part.type === 'data-memory' && part.data.userId)).toEqual([
      false,
      2,
    ]);
    expect(visibleTo(messages, 1, 1)[0]!.parts).toHaveLength(3);
  });
});
