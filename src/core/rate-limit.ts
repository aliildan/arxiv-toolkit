const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export class RateLimiter {
  private readonly intervalMs: number;
  private readonly nextAllowed = new Map<string, number>();

  constructor(intervalMs: number) {
    this.intervalMs = Math.max(0, Math.floor(intervalMs));
  }

  async acquire(host: string): Promise<void> {
    const now = Date.now();
    const nextAllowed = this.nextAllowed.get(host) ?? now;
    const wait = Math.max(0, nextAllowed - now);
    // Reserve the next slot immediately (before sleeping) so concurrent callers
    // see a monotonically advancing schedule and don't all slip through at once.
    this.nextAllowed.set(host, Math.max(now, nextAllowed) + this.intervalMs);
    if (wait > 0) {
      await sleep(wait);
    }
  }
}
