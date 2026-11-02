import { API_ROUTES } from '@open-agent/shared';
import type { BunRequest } from 'bun';

import type { ChangeFeed } from '../../application/ports/change-feed.ts';
import type { User } from '../../domain/user.ts';
import { error, type ServerHandle } from './http.ts';

export type EventHttpDependencies = {
  signedInUser: (request: BunRequest) => Promise<User | null>;
  changes: ChangeFeed;
};

/** Below the usual 60 s idle limit of reverse proxies, so a quiet stream stays open. */
const HEARTBEAT_MS = 25_000;

export function createEventRoutes({ signedInUser, changes }: EventHttpDependencies) {
  return {
    [API_ROUTES.events]: {
      GET: async (request: BunRequest, server: ServerHandle) => {
        const user = await signedInUser(request);
        if (!user) return error('not_signed_in', 401);
        // Open for as long as the page is: Bun's 10 s idle timeout would close it between two changes.
        server.timeout(request, 0);

        const encoder = new TextEncoder();
        let unsubscribe: (() => void) | null = null;
        let heartbeat: ReturnType<typeof setInterval> | undefined;
        const stop = () => {
          unsubscribe?.();
          clearInterval(heartbeat);
        };
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            const send = (text: string) => controller.enqueue(encoder.encode(text));
            unsubscribe = changes.subscribe(user.id, (change) => send(`data: ${JSON.stringify(change)}\n\n`));
            heartbeat = setInterval(() => send(': ping\n\n'), HEARTBEAT_MS);
            request.signal.addEventListener('abort', () => {
              stop();
              controller.close();
            });
            // Sent at once, so the client knows the stream is open (and catches up on what it missed).
            send(': open\n\n');
          },
          cancel: stop,
        });
        return new Response(stream, {
          headers: {
            'content-type': 'text/event-stream',
            'cache-control': 'no-cache',
            // Nginx-like proxies would otherwise hold the events back.
            'x-accel-buffering': 'no',
          },
        });
      },
    },
  };
}
