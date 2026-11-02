import type { ChangeEvent } from '@open-agent/shared';

export type { ChangeEvent };

/** Tells a user's open devices that some of their data changed, so they reload it. */
export interface ChangeFeed {
  publish(userId: number, change: ChangeEvent): void;
  /** Returns the way to stop listening. */
  subscribe(userId: number, listener: (change: ChangeEvent) => void): () => void;
}
