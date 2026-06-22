import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Cache } from "../../src/core/cache.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("Cache", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "arxiv-cache-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns a stored value for the same key object and null on miss", async () => {
    const cache = new Cache(dir);
    const key = { kind: "meta", id: "2310.06825", version: 1 };
    await cache.set(key, { title: "Test Paper" }, Infinity);

    const hit = await cache.get<{ title: string }>(key);
    expect(hit).toEqual({ title: "Test Paper" });

    const miss = await cache.get<{ title: string }>({ kind: "meta", id: "9999.99999", version: 1 });
    expect(miss).toBeNull();
  });

  it("returns null after a finite TTL expires but keeps Infinity TTL forever", async () => {
    vi.useFakeTimers({ now: 0, toFake: ["Date", "setTimeout", "clearTimeout"] });
    try {
      const cache = new Cache(dir);
      const latestKey = { kind: "meta", id: "2310.06825" }; // unversioned/latest => 24h
      const searchKey = { kind: "search", q: "transformer" }; // => 1h

      await cache.set(latestKey, { v: "latest" }, 24 * 60 * 60 * 1000);
      await cache.set(searchKey, { v: "search" }, 60 * 60 * 1000);

      expect(await cache.get<{ v: string }>(latestKey)).toEqual({ v: "latest" });

      vi.setSystemTime(23 * 60 * 60 * 1000); // 23h later: latest still valid, search expired
      expect(await cache.get<{ v: string }>(latestKey)).toEqual({ v: "latest" });
      expect(await cache.get<{ v: string }>(searchKey)).toBeNull();

      vi.setSystemTime(25 * 60 * 60 * 1000); // 25h: latest now expired too
      expect(await cache.get<{ v: string }>(latestKey)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("bypasses read and write when disabled", async () => {
    const cache = new Cache(dir, { disabled: true });
    const key = { kind: "meta", id: "2310.06825", version: 1 };
    await cache.set(key, { title: "X" }, Infinity);
    expect(await cache.get<{ title: string }>(key)).toBeNull();
    // nothing written to disk
    const { readdir } = await import("node:fs/promises");
    await expect(readdir(dir)).resolves.toEqual([]);
  });

  it("clear() empties the dir and path() returns the dir", async () => {
    const cache = new Cache(dir);
    expect(cache.path()).toBe(dir);
    await cache.set({ kind: "search", q: "a" }, { r: 1 }, 60 * 60 * 1000);
    await cache.set({ kind: "search", q: "b" }, { r: 2 }, 60 * 60 * 1000);
    const { readdir } = await import("node:fs/promises");
    expect((await readdir(dir)).length).toBeGreaterThan(0);
    await cache.clear();
    await expect(readdir(dir)).resolves.toEqual([]);
  });

  it("treats keys that differ only by source as distinct entries", async () => {
    const cache = new Cache(dir);
    const nativeKey = { kind: "content", id: "2310.06825", version: 1, source: "html-native" };
    const ar5ivKey = { kind: "content", id: "2310.06825", version: 1, source: "html-ar5iv" };
    await cache.set(nativeKey, { text: "native" }, Infinity);
    expect(await cache.get<{ text: string }>(nativeKey)).toEqual({ text: "native" });
    expect(await cache.get<{ text: string }>(ar5ivKey)).toBeNull();
  });
});
