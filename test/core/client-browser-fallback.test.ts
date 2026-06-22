import { describe, it, expect, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArxivClient } from "../../src/core/client.js";
import type { DataSource } from "../../src/core/datasource/datasource.js";
import {
  NetworkError,
  NotFoundError,
  RateLimitedError,
} from "../../src/core/errors.js";

const FIXTURE_HTML = `
<html><body>
<h1 class="ltx_title_document">Test Paper</h1>
<section class="ltx_abstract"><p>Abstract text.</p></section>
<section class="ltx_section" id="S1">
  <h2 class="ltx_title_section">Introduction</h2>
  <p>Body text.</p>
</section>
</body></html>
`;

/** A DataSource that throws NetworkError on every call. */
function failingApiSource(): DataSource {
  return {
    query: vi.fn().mockRejectedValue(new NetworkError("API blocked: 403")),
    getHtml: vi.fn().mockRejectedValue(new NetworkError("API blocked: 403")),
    getPdf: vi.fn().mockRejectedValue(new NetworkError("API blocked: 403")),
    getText: vi.fn().mockRejectedValue(new NetworkError("API blocked: 403")),
  };
}

/** A DataSource that returns null (404) on getHtml (clean miss). */
function notFoundApiSource(): DataSource {
  return {
    query: vi.fn().mockResolvedValue(""),
    getHtml: vi.fn().mockResolvedValue(null),
    getPdf: vi.fn().mockRejectedValue(new NotFoundError("Not found")),
    getText: vi.fn().mockResolvedValue(""),
  };
}

/** A DataSource returning fixture HTML for getHtml and fixture bytes for getPdf. */
function happyBrowserSource(html = FIXTURE_HTML): DataSource {
  const pdfBytes = new Uint8Array([37, 80, 68, 70, 45]);
  return {
    query: vi.fn().mockResolvedValue(html),
    getHtml: vi.fn().mockResolvedValue(html),
    getPdf: vi.fn().mockResolvedValue(pdfBytes),
    getText: vi.fn().mockResolvedValue(html),
  };
}

/** Testable subclass that lets tests inject a fake browser source. */
class TestableClient extends ArxivClient {
  private _fakeBrowser?: DataSource;

  setFakeBrowser(source: DataSource) {
    this._fakeBrowser = source;
  }

  protected override makeBrowserSource(): DataSource {
    if (!this._fakeBrowser) throw new Error("No fake browser set");
    return this._fakeBrowser;
  }
}

/**
 * Build a TestableClient with a replaced `api` field.
 * We pass `noCache: true` to skip cache interactions and inject the
 * fake API source by replacing the field after construction.
 */
function clientWith(
  apiSource: DataSource,
  opts: { browserFallback?: boolean } = {},
): TestableClient {
  const client = new TestableClient({
    noCache: true,
    browserFallback: opts.browserFallback ?? false,
    rateMs: 0,
  });
  // Replace the private api field via type assertion (test-only seam)
  (client as unknown as { api: DataSource }).api = apiSource;
  return client;
}

describe("ArxivClient browser fallback in getContent", () => {
  it("uses the browser source when API throws NetworkError and browserFallback is true", async () => {
    const browser = happyBrowserSource();
    const client = clientWith(failingApiSource(), { browserFallback: true });
    client.setFakeBrowser(browser);

    const content = await client.getContent("2310.06825", { source: "html" });
    expect(browser.getHtml).toHaveBeenCalled();
    expect(content.sections.length).toBeGreaterThan(0);
    expect(content.source).toBe("html-native");
  });

  it("does NOT use the browser when browserFallback is false and propagates the NetworkError", async () => {
    const browser = happyBrowserSource();
    const client = clientWith(failingApiSource(), { browserFallback: false });
    client.setFakeBrowser(browser);

    await expect(client.getContent("2310.06825", { source: "html" })).rejects.toMatchObject({
      code: "NETWORK",
    });
    expect(browser.getHtml).not.toHaveBeenCalled();
  });

  it("does NOT use the browser for a clean 404 (NotFoundError / null getHtml)", async () => {
    const browser = happyBrowserSource();
    // With source:'html' and both native + ar5iv returning null (404), the client
    // must NOT redirect to the browser — it should throw UnsupportedError or
    // surface the source-matrix exhaustion (NotFoundError), never the browser.
    const client = clientWith(notFoundApiSource(), { browserFallback: true });
    client.setFakeBrowser(browser);

    // getContent source:'html' exhausts native→ar5iv (both 404), should NOT fall
    // through to browser and should throw (UnsupportedError from spec §7.2 source:'html').
    // The promise must reject (UnsupportedError or similar), and the browser must NOT be used.
    await expect(client.getContent("2310.06825", { source: "html" })).rejects.toMatchObject({
      code: "UNSUPPORTED",
    });
    expect(browser.getHtml).not.toHaveBeenCalled();
  });

  it("uses the browser when API throws RateLimitedError and browserFallback is true", async () => {
    const rateLimitedApi: DataSource = {
      query: vi.fn().mockRejectedValue(new RateLimitedError("429 exhausted")),
      getHtml: vi.fn().mockRejectedValue(new RateLimitedError("429 exhausted")),
      getPdf: vi.fn().mockRejectedValue(new RateLimitedError("429 exhausted")),
      getText: vi.fn().mockRejectedValue(new RateLimitedError("429 exhausted")),
    };
    const browser = happyBrowserSource();
    const client = clientWith(rateLimitedApi, { browserFallback: true });
    client.setFakeBrowser(browser);

    const content = await client.getContent("2310.06825", { source: "html" });
    expect(browser.getHtml).toHaveBeenCalled();
    expect(content.sections.length).toBeGreaterThan(0);
  });

  it("browser source is lazily constructed (makeBrowserSource called only when needed)", async () => {
    const makeSpy = vi.fn().mockReturnValue(happyBrowserSource());
    const client = clientWith(failingApiSource(), { browserFallback: true });
    (client as unknown as { makeBrowserSource: () => DataSource }).makeBrowserSource = makeSpy;

    await client.getContent("2310.06825", { source: "html" });
    expect(makeSpy).toHaveBeenCalledTimes(1);
    // Second call should reuse the same browser instance (lazy init via ??=)
    await client.getContent("2310.06825", { source: "html" });
    expect(makeSpy).toHaveBeenCalledTimes(1);
  });
});

describe("ArxivClient download browser fallback", () => {
  it("uses the browser source when api.getPdf throws NetworkError and browserFallback is true", async () => {
    const pdfBytes = new Uint8Array([37, 80, 68, 70, 45]); // %PDF-
    const browser = happyBrowserSource();
    // Override getPdf to return specific bytes
    (browser.getPdf as ReturnType<typeof vi.fn>).mockResolvedValue(pdfBytes);

    const client = clientWith(failingApiSource(), { browserFallback: true });
    client.setFakeBrowser(browser);

    const dir = await mkdtemp(join(tmpdir(), "arxiv-dl-browser-"));
    try {
      const out = await client.download("2310.06825", { dir });
      expect(browser.getPdf).toHaveBeenCalled();
      expect(out.bytes).toBe(pdfBytes.byteLength);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does NOT use the browser when browserFallback is false", async () => {
    const browser = happyBrowserSource();
    const client = clientWith(failingApiSource(), { browserFallback: false });
    client.setFakeBrowser(browser);

    const dir = await mkdtemp(join(tmpdir(), "arxiv-dl-nobrowser-"));
    try {
      await expect(client.download("2310.06825", { dir })).rejects.toMatchObject({
        code: "NETWORK",
      });
      expect(browser.getPdf).not.toHaveBeenCalled();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
