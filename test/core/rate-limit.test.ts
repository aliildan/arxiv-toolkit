import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RateLimiter } from "../../src/core/rate-limit.js";

describe("RateLimiter", () => {
  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date", "queueMicrotask", "process.nextTick"] as any });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("spaces consecutive acquire calls on the same host by the interval", async () => {
    const limiter = new RateLimiter(1000);
    const order: string[] = [];

    const p1 = limiter.acquire("export.arxiv.org").then(() => order.push("a1"));
    await vi.advanceTimersByTimeAsync(0); // flush microtasks so the first acquire settles immediately
    expect(order).toEqual(["a1"]);

    const p2 = limiter.acquire("export.arxiv.org").then(() => order.push("a2"));
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual(["a1"]); // second still waiting
    await vi.advanceTimersByTimeAsync(1000);
    expect(order).toEqual(["a1", "a2"]);

    await p1;
    await p2;
  });

  it("lets different hosts proceed independently of each other", async () => {
    const limiter = new RateLimiter(1000);
    const done: string[] = [];

    const a = limiter.acquire("export.arxiv.org").then(() => done.push("export"));
    const b = limiter.acquire("arxiv.org").then(() => done.push("arxiv"));
    const c = limiter.acquire("ar5iv.labs.arxiv.org").then(() => done.push("ar5iv"));

    await vi.advanceTimersByTimeAsync(0);
    expect(done.sort()).toEqual(["ar5iv", "arxiv", "export"]);

    await Promise.all([a, b, c]);
  });

  it("queues concurrent same-host acquires and releases them in order, spaced by the interval", async () => {
    const limiter = new RateLimiter(500);
    const order: string[] = [];

    const p1 = limiter.acquire("arxiv.org").then(() => order.push("1"));
    const p2 = limiter.acquire("arxiv.org").then(() => order.push("2"));
    const p3 = limiter.acquire("arxiv.org").then(() => order.push("3"));

    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual(["1"]);
    await vi.advanceTimersByTimeAsync(500);
    expect(order).toEqual(["1", "2"]);
    await vi.advanceTimersByTimeAsync(500);
    expect(order).toEqual(["1", "2", "3"]);

    await Promise.all([p1, p2, p3]);
  });
});
