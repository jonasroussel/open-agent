import { describe, expect, test } from 'bun:test';

import { AnswerRuns } from './answer-runs.ts';

const ADA = { id: 1, name: 'ada', email: 'ada@example.com' };

describe('AnswerRuns', () => {
  test('a run that ended already neither frees nor erases the answer that began after it', () => {
    const runs = new AnswerRuns();
    const first = runs.begin('c1', ADA)!;
    runs.end('c1', first);
    const second = runs.begin('c1', ADA)!;

    runs.end('c1', first);
    expect(runs.who('c1')).toEqual(ADA);
    expect(runs.begin('c1', ADA)).toBeNull();
    expect(runs.replaced('c1', first)).toBe(true);
    expect(runs.replaced('c1', second)).toBe(false);
    runs.end('c1', second);
  });
});
