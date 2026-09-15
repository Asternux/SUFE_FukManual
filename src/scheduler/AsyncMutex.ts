import { setTimeout as delay } from "node:timers/promises";

export interface ExclusiveRunner {
  runExclusive<T>(task: () => Promise<T>): Promise<T>;
}

export class AsyncMutex implements ExclusiveRunner {
  private tail: Promise<void> = Promise.resolve();
  private lastCompletedAt = 0;

  public constructor(private readonly minIntervalMs = 0) {}

  public async runExclusive<T>(task: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      const remaining = this.lastCompletedAt + this.minIntervalMs - Date.now();
      if (remaining > 0) await delay(remaining);
      return await task();
    } finally {
      this.lastCompletedAt = Date.now();
      release();
    }
  }
}

export const directRunner: ExclusiveRunner = {
  runExclusive: async <T>(task: () => Promise<T>): Promise<T> => task()
};
