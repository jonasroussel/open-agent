import { expect, test } from 'bun:test';

import { clientAddress } from './http.ts';

const proxy = { requestIP: () => ({ address: '10.0.0.2' }), timeout: () => {} };
const forwardedFor = (header: string) => new Request('http://localhost/', { headers: { 'x-forwarded-for': header } });

test('behind the proxy, the limits count the address the proxy saw, not the ones the client wrote before it', () => {
  const first = clientAddress(forwardedFor('198.51.100.1, 203.0.113.7'), proxy, true);
  const second = clientAddress(forwardedFor('198.51.100.2,203.0.113.7'), proxy, true);

  expect([first, second]).toEqual(['203.0.113.7', '203.0.113.7']);
});
