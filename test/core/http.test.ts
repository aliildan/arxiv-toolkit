import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Http, MAX_RETRIES } from "../../src/core/http.js";
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

  it("returns null on 404 for getText and throws NotFoundError for getBytes", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    const http = new Http(baseCfg(), new RateLimiter(0));

    expect(await http.getText("https://arxiv.org/html/0000.00000")).toBeNull();

    await expect(http.getBytes("https://arxiv.org/pdf/0000.00000")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("retries 5xx with backoff honoring Retry-After and succeeds", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date", "queueMicrotask", "process.nextTick"] as any });
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

  it("throws RateLimitedError after exhausting 429 retries", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date", "queueMicrotask", "process.nextTick"] as any });
    try {
      fetchMock.mockResolvedValue(new Response(null, { status: 429 }));
      const http = new Http(baseCfg(), new RateLimiter(0));
      // Attach rejection handler immediately to avoid unhandled-rejection warning
      let caughtErr: unknown;
      const p = http.getText("https://export.arxiv.org/api/query?x=2").catch((e) => { caughtErr = e; });
      for (let i = 0; i < MAX_RETRIES + 1; i++) {
        await vi.advanceTimersByTimeAsync(10000);
      }
      await p;
      expect(caughtErr).toMatchObject({ code: "RATE_LIMITED" });
      expect(fetchMock).toHaveBeenCalledTimes(MAX_RETRIES + 1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("throws NetworkError after exhausting retries on a fetch rejection", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date", "queueMicrotask", "process.nextTick"] as any });
    try {
      fetchMock.mockRejectedValue(new TypeError("fetch failed"));
      const http = new Http(baseCfg(), new RateLimiter(0));
      // Attach rejection handler immediately to avoid unhandled-rejection warning
      let caughtErr: unknown;
      const p = http.getBytes("https://arxiv.org/pdf/2310.06825").catch((e) => { caughtErr = e; });
      for (let i = 0; i < MAX_RETRIES + 1; i++) {
        await vi.advanceTimersByTimeAsync(10000);
      }
      await p;
      expect(caughtErr).toMatchObject({ code: "NETWORK" });
      expect(fetchMock).toHaveBeenCalledTimes(MAX_RETRIES + 1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("getBytes returns response bytes as Uint8Array on 200", async () => {
    const bytes = new Uint8Array([37, 80, 68, 70, 45]); // "%PDF-"
    fetchMock.mockResolvedValueOnce(new Response(bytes, { status: 200, headers: { "Content-Type": "application/pdf" } }));
    const http = new Http(baseCfg(), new RateLimiter(0));
    const got = await http.getBytes("https://arxiv.org/pdf/2310.06825");
    expect(got).toBeInstanceOf(Uint8Array);
    expect(Array.from(got)).toEqual([37, 80, 68, 70, 45]);
  });

  it("retries on timeout and ultimately throws NetworkError", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date", "queueMicrotask", "process.nextTick"] as any });
    try {
      const timeoutErr = Object.assign(new DOMException("The operation timed out.", "TimeoutError"), {});
      fetchMock.mockRejectedValue(timeoutErr);
      const http = new Http(baseCfg(), new RateLimiter(0));
      // Attach rejection handler immediately to avoid unhandled-rejection warning
      let caughtErr: unknown;
      const p = http.getText("https://export.arxiv.org/api/query?x=timeout").catch((e) => { caughtErr = e; });
      for (let i = 0; i < MAX_RETRIES + 1; i++) {
        await vi.advanceTimersByTimeAsync(10000);
      }
      await p;
      expect(caughtErr).toMatchObject({ code: "NETWORK" });
      expect(fetchMock).toHaveBeenCalledTimes(MAX_RETRIES + 1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("acquires the limiter once per request, keyed by hostname", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(textResponse("ok")));
    const limiter = new RateLimiter(0);
    const spy = vi.spyOn(limiter, "acquire");
    const http = new Http(baseCfg(), limiter);
    await http.getText("https://export.arxiv.org/api/query?x=1");
    await http.getText("https://arxiv.org/abs/2310.06825");
    expect(spy).toHaveBeenCalledWith("export.arxiv.org");
    expect(spy).toHaveBeenCalledWith("arxiv.org");
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
