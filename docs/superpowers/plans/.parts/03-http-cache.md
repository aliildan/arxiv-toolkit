<!-- Phase: HTTP + rate-limit + cache -->

### Task: RateLimiter (per-host min-interval)

**Files:**
- Create: `src/core/rate-limit.ts`
- Test: `test/core/rate-limit.test.ts`

**Interfaces:**
- Consumes: none (leaf utility).
- Produces: `export class RateLimiter { constructor(intervalMs: number); acquire(host: string): Promise<void> }` — per exact-hostname minimum spacing; concurrent `acquire` calls for the same host serialize with the configured interval between releases; different hosts proceed independently.

- [ ] **Step 1: Write the failing rate-limit test (per-host spacing, single host).** Create `test/core/rate-limit.test.ts`. This test uses fake timers and asserts two sequential `acquire` calls on the same host are spaced by the configured interval.

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RateLimiter } from "../../src/core/rate-limit.js";

describe("RateLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date", "queueMicrotask", "process.nextTick"] });
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
});
```

Run: `npx vitest run test/core/rate-limit.test.ts` — expect FAIL (module `../../src/core/rate-limit.js` does not exist yet / cannot resolve).

- [ ] **Step 2: Implement the minimal RateLimiter.** Create `src/core/rate-limit.ts`:

```ts
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
    if (wait > 0) {
      await sleep(wait);
    }
    // Schedule the next allowed time for this host. Because acquire is awaited
    // sequentially per host by callers (and the same-host queue below preserves
    // order), this stamp is set after the wait completes.
    const after = Date.now();
    this.nextAllowed.set(host, after + this.intervalMs);
  }
}
```

Run: `npx vitest run test/core/rate-limit.test.ts` — expect PASS.

- [ ] **Step 3: Add a failing test for cross-host independence.** Append to `test/core/rate-limit.test.ts` inside the `describe` block:

```ts
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
```

Run: `npx vitest run test/core/rate-limit.test.ts` — expect PASS already (the implementation keys by exact hostname). If it fails, revisit the host-keying. (If passing, this step locks the behavior against regression.)

- [ ] **Step 4: Add a failing test for queued concurrency on one host (FIFO ordering).** Append to the `describe` block:

```ts
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
```

Run: `npx vitest run test/core/rate-limit.test.ts` — expect PASS (the stamp-based scheduling yields FIFO spacing). If it fails, rework the in-flight tracking so concurrent same-host acquires do not all read the same `nextAllowed` stamp and slip through at once.

- [ ] **Step 5: Commit.** Run:

```bash
git add src/core/rate-limit.ts test/core/rate-limit.test.ts && git commit -m "feat(core): add per-host RateLimiter with fake-timer tests"
```

---

### Task: Cache (hashed key + sidecar TTL, get/set/clear/path)

**Files:**
- Create: `src/core/cache.ts`
- Test: `test/core/cache.test.ts`

**Interfaces:**
- Consumes: none at runtime (uses `node:fs`/`node:crypto`).
- Produces: `export class Cache { constructor(dir: string, opts?: { disabled?: boolean }); get<T>(key: object): Promise<T|null>; set(key: object, value: unknown, ttlMs: number): Promise<void>; clear(): Promise<void>; path(): string }` — key is a stable JSON hash (sha256 of `JSON.stringify` with sorted-ish stable serialization); each entry is `<hash>.json` plus a sidecar `<hash>.meta.json` storing `{ fetchedAt, ttl, key }`; `get` returns `null` on miss, disabled cache, or expired TTL (where `ttl !== Infinity` and `Date.now() - fetchedAt > ttl`); `Infinity` TTL never expires; `clear()` removes all files in `dir`; `path()` returns `dir`.

- [ ] **Step 1: Write the failing cache test (set then get, same key shape).** Create `test/core/cache.test.ts`. Use a temp directory under `os.tmpdir()` unique per test run.

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
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
});
```

Run: `npx vitest run test/core/cache.test.ts` — expect FAIL (module does not exist).

- [ ] **Step 2: Implement the minimal Cache (hash + sidecar + Infinity TTL).** Create `src/core/cache.ts`:

```ts
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";

const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .map((k) => JSON.stringify(k) + ":" + stableStringify((value as Record<string, unknown>)[k]));
  return "{" + entries.join(",") + "}";
};

const hashKey = (key: object): string =>
  createHash("sha256").update(stableStringify(key)).digest("hex").slice(0, 32);

export interface CacheEntryMeta {
  fetchedAt: number;
  ttl: number;
  key: unknown;
}

export class Cache {
  private readonly dir: string;
  private readonly disabled: boolean;

  constructor(dir: string, opts?: { disabled?: boolean }) {
    this.dir = dir;
    this.disabled = opts?.disabled ?? false;
  }

  path(): string {
    return this.dir;
  }

  private async ensureDir(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
  }

  async get<T>(key: object): Promise<T | null> {
    if (this.disabled) return null;
    const h = hashKey(key);
    const dataPath = join(this.dir, `${h}.json`);
    const metaPath = join(this.dir, `${h}.meta.json`);
    let meta: CacheEntryMeta;
    try {
      const metaBuf = await readFile(metaPath, "utf8");
      meta = JSON.parse(metaBuf) as CacheEntryMeta;
    } catch {
      return null; // no sidecar => miss
    }
    if (meta.ttl !== Infinity && Date.now() - meta.fetchedAt > meta.ttl) {
      return null; // expired
    }
    try {
      const dataBuf = await readFile(dataPath, "utf8");
      return JSON.parse(dataBuf) as T;
    } catch {
      return null;
    }
  }

  async set(key: object, value: unknown, ttlMs: number): Promise<void> {
    if (this.disabled) return;
    await this.ensureDir();
    const h = hashKey(key);
    const dataPath = join(this.dir, `${h}.json`);
    const metaPath = join(this.dir, `${h}.meta.json`);
    const meta: CacheEntryMeta = { fetchedAt: Date.now(), ttl: ttlMs, key };
    await writeFile(dataPath, JSON.stringify(value), "utf8");
    await writeFile(metaPath, JSON.stringify(meta), "utf8");
  }

  async clear(): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(this.dir);
    } catch {
      return; // dir does not exist yet
    }
    await Promise.all(
      entries.map((name) => rm(join(this.dir, name), { force: true })),
    );
  }
}
```

Run: `npx vitest run test/core/cache.test.ts` — expect PASS.

- [ ] **Step 3: Add a failing test for TTL expiry (latest = 24h, search = 1h semantics).** Append to the `describe` block. Use fake timers to advance past the TTL.

```ts
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
```

Run: `npx vitest run test/core/cache.test.ts` — expect PASS (the TTL comparison already handles finite TTL). This step locks the mutability-based TTL contract.

- [ ] **Step 4: Add a failing test for the disabled bypass (no read, no write).** Append to the `describe` block:

```ts
  it("bypasses read and write when disabled", async () => {
    const cache = new Cache(dir, { disabled: true });
    const key = { kind: "meta", id: "2310.06825", version: 1 };
    await cache.set(key, { title: "X" }, Infinity);
    expect(await cache.get<{ title: string }>(key)).toBeNull();
    // nothing written to disk
    const { readdir } = await import("node:fs/promises");
    await expect(readdir(dir)).resolves.toEqual([]);
  });
```

Run: `npx vitest run test/core/cache.test.ts` — expect PASS (both `get` and `set` short-circuit on `disabled`). This locks the `--no-cache`/`ARXIV_NO_CACHE` bypass.

- [ ] **Step 5: Add a failing test for clear() and path().** Append to the `describe` block:

```ts
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
```

Run: `npx vitest run test/core/cache.test.ts` — expect PASS.

- [ ] **Step 6: Add a test that keys differing only by `source` do not collide (cross-source miss).** Append to the `describe` block:

```ts
  it("treats keys that differ only by source as distinct entries", async () => {
    const cache = new Cache(dir);
    const nativeKey = { kind: "content", id: "2310.06825", version: 1, source: "html-native" };
    const ar5ivKey = { kind: "content", id: "2310.06825", version: 1, source: "html-ar5iv" };
    await cache.set(nativeKey, { text: "native" }, Infinity);
    expect(await cache.get<{ text: string }>(nativeKey)).toEqual({ text: "native" });
    expect(await cache.get<{ text: string }>(ar5ivKey)).toBeNull();
  });
```

Run: `npx vitest run test/core/cache.test.ts` — expect PASS. This locks the contract's "a hit for one `source` does not satisfy a request for a different `source`."

- [ ] **Step 7: Commit.** Run:

```bash
git add src/core/cache.ts test/core/cache.test.ts && git commit -m "feat(core): add filesystem Cache with hashed keys and sidecar TTL"
```

---

### Task: Http (UA header, timeout, retry/backoff, limiter routing, 404 semantics)

**Files:**
- Create: `src/core/http.ts`
- Test: `test/core/http.test.ts`

**Interfaces:**
- Consumes: `ArxivConfig` from `../core/types.js`; `RateLimiter` from `./rate-limit.js` (`acquire(host)`); `Cache` from `./cache.js` (optional, may be `undefined`); `NotFoundError`, `RateLimitedError`, `NetworkError` from `./errors.js` with codes `NOT_FOUND`/`RATE_LIMITED`/`NETWORK`. Also `exitCodeFor` is exported by errors but not needed here.
- Produces: `export class Http { constructor(cfg: ArxivConfig, limiter: RateLimiter, cache?: Cache); getText(url: string): Promise<string|null>; getBytes(url: string): Promise<Uint8Array> }` — sets `User-Agent` to `cfg.userAgent`, applies a timeout, acquires the limiter for the request's hostname, retries `429`/`5xx` and network errors with exponential backoff + jitter honoring `Retry-After`, and: on HTTP 404 `getText` returns `null` while `getBytes` throws `NotFoundError`; exhausted retries on `429` => `RateLimitedError`, on `5xx`/network => `NetworkError`. `getBytes` returns the response body as `Uint8Array`.

- [ ] **Step 1: Write the failing Http test (getText success sends UA header and routes through limiter).** Create `test/core/http.test.ts`. Mock global `fetch` and use a real `RateLimiter` (no fake timers needed for the success path) plus a minimal `ArxivConfig`.

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Http } from "../../src/core/http.js";
import { RateLimiter } from "../../src/core/rate-limit.js";
import type { ArxivConfig } from "../../src/core/types.js";

const baseCfg = (): ArxivConfig => ({
  cacheDir: "/tmp/arxiv-cache",
  downloadsDir: "/tmp/arxiv-dl",
  configDir: "/tmp/arxiv-cfg",
  rateMs: 0,
  userAgent: "arxiv-toolkit/0.1.0 (+https://example.com; mailto:test@example.com)",
  noCache: true,
  defaultMaxResults: 25,
  browserFallback: false,
});

function textResponse(body: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers });
}

describe("Http", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("getText sends the configured User-Agent and returns the body", async () => {
    fetchMock.mockResolvedValueOnce(textResponse("<atom/>"));
    const http = new Http(baseCfg(), new RateLimiter(0));
    const body = await http.getText("https://export.arxiv.org/api/query?search_query=all:cat");
    expect(body).toBe("<atom/>");
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers["User-Agent"]).toBe(baseCfg().userAgent);
  });
});
```

Run: `npx vitest run test/core/http.test.ts` — expect FAIL (module does not exist).

- [ ] **Step 2: Implement the minimal Http (UA + limiter + getText/getBytes, no retry yet).** Create `src/core/http.ts`:

```ts
import { NotFoundError } from "./errors.js";
import type { ArxivConfig } from "./types.js";
import type { RateLimiter } from "./rate-limit.js";
import type { Cache } from "./cache.js";

const hostnameOf = (url: string): string => {
  const u = new URL(url);
  return u.hostname;
};

export class Http {
  private readonly cfg: ArxivConfig;
  private readonly limiter: RateLimiter;
  private readonly cache?: Cache;

  constructor(cfg: ArxivConfig, limiter: RateLimiter, cache?: Cache) {
    this.cfg = cfg;
    this.limiter = limiter;
    this.cache = cache;
  }

  private async request(url: string, accept: string): Promise<Response> {
    await this.limiter.acquire(hostnameOf(url));
    return fetch(url, {
      method: "GET",
      headers: { "User-Agent": this.cfg.userAgent, Accept: accept },
    });
  }

  async getText(url: string): Promise<string | null> {
    const res = await this.request(url, "text/plain, application/xml; q=0.9, */*; q=0.5");
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res.text();
  }

  async getBytes(url: string): Promise<Uint8Array> {
    const res = await this.request(url, "application/pdf, */*; q=0.5");
    if (res.status === 404) {
      throw new NotFoundError(`Not found: ${url}`);
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  }
}
```

Run: `npx vitest run test/core/http.test.ts` — expect PASS.

- [ ] **Step 3: Add a failing test for 404 semantics (getText null, getBytes throws NotFoundError).** Append to the `describe` block:

```ts
  it("returns null on 404 for getText and throws NotFoundError for getBytes", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    const http = new Http(baseCfg(), new RateLimiter(0));

    expect(await http.getText("https://arxiv.org/html/0000.00000")).toBeNull();

    await expect(http.getBytes("https://arxiv.org/pdf/0000.00000")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
```

Run: `npx vitest run test/core/http.test.ts` — expect PASS (404 handling already in place). This locks the asymmetric 404 contract.

- [ ] **Step 4: Add a failing test for retry on 500 then success with backoff honoring Retry-After.** Append to the `describe` block. Use fake timers so the backoff `setTimeout` advances deterministically; the limiter interval is 0 so it does not add waits.

```ts
  it("retries 5xx with backoff honoring Retry-After and succeeds", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date", "queueMicrotask", "process.nextTick"] });
    try {
      fetchMock
        .mockResolvedValueOnce(new Response(null, { status: 503, headers: { "Retry-After": "2" } }))
        .mockResolvedValueOnce(textResponse("ok"));
      const http = new Http(baseCfg(), new RateLimiter(0));
      const p = http.getText("https://export.arxiv.org/api/query?x=1");
      // settle microtasks for first fetch + the Retry-After sleep scheduling
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(2000); // honor Retry-After: 2s
      const body = await p;
      expect(body).toBe("ok");
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
```

Run: `npx vitest run test/core/http.test.ts` — expect FAIL (current implementation throws on the first 503 instead of retrying).

- [ ] **Step 5: Add retry/backoff honoring Retry-After to Http.** Replace the body of `src/core/http.ts` with the retry-aware version. The retry loop: max 3 attempts beyond the initial request; on `429`/`5xx` compute delay = `Retry-After` header (seconds) if present, else exponential backoff `base * 2^attempt` + jitter; sleep via `setTimeout`; after exhausting retries, `429` => `RateLimitedError`, `5xx` => `NetworkError`; network errors (fetch rejects) are retried the same way and exhaust into `NetworkError`.

```ts
import { NotFoundError, RateLimitedError, NetworkError } from "./errors.js";
import type { ArxivConfig } from "./types.js";
import type { RateLimiter } from "./rate-limit.js";
import type { Cache } from "./cache.js";

const hostnameOf = (url: string): string => new URL(url).hostname;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 500;

const isRetryableStatus = (status: number): boolean => status === 429 || (status >= 500 && status < 600);

const retryAfterMs = (res: Response): number | null => {
  const ra = res.headers.get("retry-after");
  if (!ra) return null;
  const seconds = Number(ra);
  if (Number.isFinite(seconds)) return seconds * 1000;
  const date = Date.parse(ra);
  return Number.isNaN(date) ? null : date - Date.now();
};

const backoffMs = (attempt: number): number => {
  const base = BASE_BACKOFF_MS * 2 ** attempt;
  const jitter = Math.floor(Math.random() * 250);
  return base + jitter;
};

export class Http {
  private readonly cfg: ArxivConfig;
  private readonly limiter: RateLimiter;
  private readonly cache?: Cache;

  constructor(cfg: ArxivConfig, limiter: RateLimiter, cache?: Cache) {
    this.cfg = cfg;
    this.limiter = limiter;
    this.cache = cache;
  }

  private async fetchWithRetry(url: string, accept: string): Promise<Response> {
    let lastResponse: Response | null = null;
    let lastError: unknown = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      await this.limiter.acquire(hostnameOf(url));
      try {
        const res = await fetch(url, {
          method: "GET",
          headers: { "User-Agent": this.cfg.userAgent, Accept: accept },
        });
        if (!isRetryableStatus(res.status)) {
          return res;
        }
        lastResponse = res;
        if (attempt === MAX_RETRIES) break;
        const ra = retryAfterMs(res);
        const delay = ra !== null && ra > 0 ? ra : backoffMs(attempt);
        await sleep(delay);
      } catch (err) {
        lastError = err;
        lastResponse = null;
        if (attempt === MAX_RETRIES) break;
        await sleep(backoffMs(attempt));
      }
    }
    if (lastResponse) {
      if (lastResponse.status === 429) {
        throw new RateLimitedError(`Rate limited by ${hostnameOf(url)}`);
      }
      throw new NetworkError(`HTTP ${lastResponse.status} for ${url}`);
    }
    throw new NetworkError(`Network error for ${url}: ${String(lastError)}`);
  }

  async getText(url: string): Promise<string | null> {
    const res = await this.fetchWithRetry(url, "text/plain, application/xml; q=0.9, */*; q=0.5");
    if (res.status === 404) return null;
    if (!res.ok) throw new NetworkError(`HTTP ${res.status} for ${url}`);
    return res.text();
  }

  async getBytes(url: string): Promise<Uint8Array> {
    const res = await this.fetchWithRetry(url, "application/pdf, */*; q=0.5");
    if (res.status === 404) throw new NotFoundError(`Not found: ${url}`);
    if (!res.ok) throw new NetworkError(`HTTP ${res.status} for ${url}`);
    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  }
}
```

Run: `npx vitest run test/core/http.test.ts` — expect PASS (503 retried after Retry-After: 2s, then 200 "ok"; 2 fetch calls). The fake-timer `toFake` list includes `queueMicrotask`/`process.nextTick` so the awaited fetch microtasks settle under `advanceTimersByTimeAsync`.

- [ ] **Step 6: Add a failing test that exhausted 429 retries throw RateLimitedError.** Append to the `describe` block:

```ts
  it("throws RateLimitedError after exhausting 429 retries", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date", "queueMicrotask", "process.nextTick"] });
    try {
      fetchMock.mockResolvedValue(new Response(null, { status: 429 }));
      const http = new Http(baseCfg(), new RateLimiter(0));
      const p = http.getText("https://export.arxiv.org/api/query?x=2");
      // drain all retry sleeps (MAX_RETRIES+1 attempts, each with a backoff)
      for (let i = 0; i <= MAX_RETRIES_DRAIN; i++) {
        await vi.advanceTimersByTimeAsync(10000);
      }
      await expect(p).rejects.toMatchObject({ code: "RATE_LIMITED" });
      expect(fetchMock).toHaveBeenCalledTimes(MAX_RETRIES_DRAIN);
    } finally {
      vi.useRealTimers();
    }
  });
```

To make the constants referenceable, export them from `http.ts`. Update the exports in `src/core/http.ts`:

```ts
export const MAX_RETRIES = 3;
export const BASE_BACKOFF_MS = 500;
```

and import them in the test header:

```ts
import { Http, MAX_RETRIES } from "../../src/core/http.js";
```

Then replace the placeholder loop bounds in that test with the real constant: `MAX_RETRIES_DRAIN` => `MAX_RETRIES + 1` for the loop iterations, and `MAX_RETRIES_DRAIN` => `MAX_RETRIES + 1` for the call-count assertion. The final test body becomes:

```ts
  it("throws RateLimitedError after exhausting 429 retries", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date", "queueMicrotask", "process.nextTick"] });
    try {
      fetchMock.mockResolvedValue(new Response(null, { status: 429 }));
      const http = new Http(baseCfg(), new RateLimiter(0));
      const p = http.getText("https://export.arxiv.org/api/query?x=2");
      for (let i = 0; i < MAX_RETRIES + 1; i++) {
        await vi.advanceTimersByTimeAsync(10000);
      }
      await expect(p).rejects.toMatchObject({ code: "RATE_LIMITED" });
      expect(fetchMock).toHaveBeenCalledTimes(MAX_RETRIES + 1);
    } finally {
      vi.useRealTimers();
    }
  });
```

Run: `npx vitest run test/core/http.test.ts` — expect PASS. (Confirm `fetch` was called `MAX_RETRIES + 1` times: the initial attempt plus 3 retries.)

- [ ] **Step 7: Add a failing test that a network error (fetch rejects) exhausts into NetworkError.** Append to the `describe` block:

```ts
  it("throws NetworkError after exhausting retries on a fetch rejection", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date", "queueMicrotask", "process.nextTick"] });
    try {
      fetchMock.mockRejectedValue(new TypeError("fetch failed"));
      const http = new Http(baseCfg(), new RateLimiter(0));
      const p = http.getBytes("https://arxiv.org/pdf/2310.06825");
      for (let i = 0; i < MAX_RETRIES + 1; i++) {
        await vi.advanceTimersByTimeAsync(10000);
      }
      await expect(p).rejects.toMatchObject({ code: "NETWORK" });
      expect(fetchMock).toHaveBeenCalledTimes(MAX_RETRIES + 1);
    } finally {
      vi.useRealTimers();
    }
  });
```

Run: `npx vitest run test/core/http.test.ts` — expect PASS. This locks network-error retry behavior.

- [ ] **Step 8: Add a test that getBytes returns the body bytes for a 200 PDF.** Append to the `describe` block:

```ts
  it("getBytes returns response bytes as Uint8Array on 200", async () => {
    const bytes = new Uint8Array([37, 80, 68, 70, 45]); // "%PDF-"
    fetchMock.mockResolvedValueOnce(new Response(bytes, { status: 200, headers: { "Content-Type": "application/pdf" } }));
    const http = new Http(baseCfg(), new RateLimiter(0));
    const got = await http.getBytes("https://arxiv.org/pdf/2310.06825");
    expect(got).toBeInstanceOf(Uint8Array);
    expect(Array.from(got)).toEqual([37, 80, 68, 70, 45]);
  });
```

Run: `npx vitest run test/core/http.test.ts` — expect PASS.

- [ ] **Step 9: Add a test that the limiter is acquired per hostname (two hosts, two acquire calls).** Append to the `describe` block, using a spy limiter to record `acquire` calls:

```ts
  it("acquires the limiter once per request, keyed by hostname", async () => {
    fetchMock.mockResolvedValue(textResponse("ok"));
    const limiter = new RateLimiter(0);
    const spy = vi.spyOn(limiter, "acquire");
    const http = new Http(baseCfg(), limiter);
    await http.getText("https://export.arxiv.org/api/query?x=1");
    await http.getText("https://arxiv.org/abs/2310.06825");
    expect(spy).toHaveBeenCalledWith("export.arxiv.org");
    expect(spy).toHaveBeenCalledWith("arxiv.org");
    expect(spy).toHaveBeenCalledTimes(2);
  });
```

Run: `npx vitest run test/core/http.test.ts` — expect PASS. This locks per-host limiter routing.

- [ ] **Step 10: Commit.** Run:

```bash
git add src/core/http.ts test/core/http.test.ts && git commit -m "feat(core): add Http wrapper with UA, retry/backoff, limiter routing, 404 semantics"
```