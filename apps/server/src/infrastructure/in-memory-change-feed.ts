import type { ChangeEvent, ChangeFeed } from '../application/ports/change-feed.ts';

/** One server process, so its own memory reaches every open device. A second instance would need a shared bus. */
export class InMemoryChangeFeed implements ChangeFeed {
  readonly #listeners = new Map<number, Set<(change: ChangeEvent) => void>>();

  publish(userId: number, change: ChangeEvent): void {
    for (const listener of this.#listeners.get(userId) ?? []) listener(change);
  }

  subscribe(userId: number, listener: (change: ChangeEvent) => void): () => void {
    const listeners = this.#listeners.get(userId) ?? new Set();
    listeners.add(listener);
    this.#listeners.set(userId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.#listeners.delete(userId);
    };
  }
}
