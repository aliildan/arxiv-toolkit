<!-- Phase: Browser fallback -->

### Task A — `src/core/datasource/browser.ts`: BrowserDataSource

**Files:**
- Create: `src/core/datasource/browser.ts`
- Create: `test/core/datasource/browser.test.ts`

**Interfaces:**
- Consumes: `DataSource` from `./datasource.js`; `UnsupportedError`, `NetworkError`, `NotFoundError` from `../errors.js`.
- Produces: `export class BrowserDataSource implements DataSource` with a constructor that accepts an optional `launcher` parameter (the test seam); `query(url)`, `getHtml(url)`, `getPdf(url)`, `getText(url)` — all backed by lazy `await import("playwright-core")`. If the dynamic import fails or no browser binary is found, every method throws `UnsupportedError` with install guidance. For HTML-returning methods (`query`/`getHtml`/`getText`), the browser navigates the URL and returns `page.content()`. For `getPdf(url)`, the browser navigates the URL and returns the rendered PDF bytes via `page.pdf()`. `getHtml` returns `null` on a 404 response (mirrors `ApiDataSource.getHtml` null semantics); all other network failures throw `NetworkError`.

**Constructor injection contract (test seam):**

```ts
type BrowserLauncher = {
  launch(options?: { headless?: boolean }): Promise<{
    newPage(): Promise<{
      goto(url: string, options?: { waitUntil?: string }): Promise<{ status(): number } | null>;
      content(): Promise<string>;
      pdf(): Promise<Buffer>;
      close(): Promise<void>;
    }>;
    close(): Promise<void>;
  }>;
};

type PlaywrightImporter = () => Promise<{ chromium: BrowserLauncher }>;
```

The constructor takes `opts?: { importer?: PlaywrightImporter }`. In production (no `importer` provided), the method body calls `await import("playwright-core")` inline and reads `.chromium`. If the dynamic import throws a `MODULE_NOT_FOUND`-style error, the catch block throws `UnsupportedError`.

- [ ] **Step 1: Write failing tests for BrowserDataSource.** Create `test/core/datasource/browser.test.ts`. Tests: (a) happy-path `getHtml` with injected fake launcher returns fixture HTML string, (b) `getHtml` returns `null` on 404 response, (c) `getPdf` with injected fake launcher returns fixture bytes as `Uint8Array`, (d) missing module import throws `UnsupportedError` with install guidance text, (e) `query` and `getText` with injected fake launcher return body string.

```ts
import { describe, it, expect, vi } from "vitest";
import { BrowserDataSource } from "../../../src/core/datasource/browser.js";
import { UnsupportedError } from "../../../src/core/errors.js";

const FIXTURE_HTML = "<html><body><h1>Test Paper</h1></body></html>";
const FIXTURE_PDF = new Uint8Array([37, 80, 68, 70, 45]); // %PDF-

function makeFakeLauncher(
  html: string,
  pdfBytes: Uint8Array,
  status = 200,
): { chromium: import("../../../src/core/datasource/browser.js").BrowserLauncher } {
  const fakePage = {
    goto: vi.fn().mockResolvedValue({ status: () => status }),
    content: vi.fn().mockResolvedValue(html),
    pdf: vi.fn().mockResolvedValue(Buffer.from(pdfBytes)),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const fakeBrowser = {
    newPage: vi.fn().mockResolvedValue(fakePage),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const chromium = { launch: vi.fn().mockResolvedValue(fakeBrowser) };
  return { chromium, fakePage, fakeBrowser };
}

describe("BrowserDataSource", () => {
  it("getHtml returns rendered HTML on 200", async () => {
    const { chromium } = makeFakeLauncher(FIXTURE_HTML, FIXTURE_PDF);
    const importer = async () => ({ chromium });
    const ds = new BrowserDataSource({ importer });
    const html = await ds.getHtml("https://arxiv.org/html/2310.06825");
    expect(html).toBe(FIXTURE_HTML);
  });

  it("getHtml returns null on 404", async () => {
    const { chromium } = makeFakeLauncher(FIXTURE_HTML, FIXTURE_PDF, 404);
    const importer = async () => ({ chromium });
    const ds = new BrowserDataSource({ importer });
    const html = await ds.getHtml("https://arxiv.org/html/0000.00000");
    expect(html).toBeNull();
  });

  it("query returns page content string", async () => {
    const { chromium } = makeFakeLauncher(FIXTURE_HTML, FIXTURE_PDF);
    const importer = async () => ({ chromium });
    const ds = new BrowserDataSource({ importer });
    const text = await ds.query("https://export.arxiv.org/api/query?search_query=all:test");
    expect(text).toBe(FIXTURE_HTML);
  });

  it("getText returns page content string", async () => {
    const { chromium } = makeFakeLauncher(FIXTURE_HTML, FIXTURE_PDF);
    const importer = async () => ({ chromium });
    const ds = new BrowserDataSource({ importer });
    const text = await ds.getText("https://arxiv.org/bibtex/2310.06825");
    expect(text).toBe(FIXTURE_HTML);
  });

  it("getPdf returns Uint8Array of page PDF bytes", async () => {
    const { chromium } = makeFakeLauncher(FIXTURE_HTML, FIXTURE_PDF);
    const importer = async () => ({ chromium });
    const ds = new BrowserDataSource({ importer });
    const bytes = await ds.getPdf("https://arxiv.org/pdf/2310.06825.pdf");
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(Array.from(bytes)).toEqual(Array.from(FIXTURE_PDF));
  });

  it("throws UnsupportedError with install guidance when playwright-core is missing", async () => {
    const failingImporter = async () => {
      throw Object.assign(new Error("Cannot find module 'playwright-core'"), {
        code: "MODULE_NOT_FOUND",
      });
    };
    const ds = new BrowserDataSource({ importer: failingImporter });
    await expect(ds.getHtml("https://arxiv.org/html/2310.06825")).rejects.toMatchObject({
      code: "UNSUPPORTED",
      message: expect.stringContaining("playwright install chromium"),
    });
  });

  it("browser and page are closed after a successful call", async () => {
    const { chromium, fakeBrowser, fakePage } = makeFakeLauncher(FIXTURE_HTML, FIXTURE_PDF) as ReturnType<typeof makeFakeLauncher> & { fakeBrowser: { close: ReturnType<typeof vi.fn> }; fakePage: { close: ReturnType<typeof vi.fn> } };
    const importer = async () => ({ chromium });
    const ds = new BrowserDataSource({ importer });
    await ds.getHtml("https://arxiv.org/html/2310.06825");
    expect(fakePage.close).toHaveBeenCalledTimes(1);
    expect(fakeBrowser.close).toHaveBeenCalledTimes(1);
  });
});
```

Run: `npx vitest run test/core/datasource/browser.test.ts` — expect FAIL (module does not exist yet).

- [ ] **Step 2: Implement BrowserDataSource.** Create `src/core/datasource/browser.ts`.

```ts
import type { DataSource } from "./datasource.js";
import { UnsupportedError, NetworkError, NotFoundError } from "../errors.js";

export type BrowserLauncher = {
  launch(options?: { headless?: boolean }): Promise<BrowserInstance>;
};

type BrowserInstance = {
  newPage(): Promise<PageInstance>;
  close(): Promise<void>;
};

type PageInstance = {
  goto(
    url: string,
    options?: { waitUntil?: string },
  ): Promise<{ status(): number } | null>;
  content(): Promise<string>;
  pdf(): Promise<Buffer>;
  close(): Promise<void>;
};

export type PlaywrightImporter = () => Promise<{ chromium: BrowserLauncher }>;

export interface BrowserDataSourceOptions {
  importer?: PlaywrightImporter;
}

const INSTALL_GUIDANCE =
  "No browser binary found. Install one with: npx playwright install chromium\n" +
  "Then re-run with --browser or ARXIV_BROWSER=1.";

async function loadChromium(importer?: PlaywrightImporter): Promise<BrowserLauncher> {
  const doImport = importer ?? (async () => import("playwright-core") as Promise<{ chromium: BrowserLauncher }>);
  try {
    const pw = await doImport();
    return pw.chromium;
  } catch (err) {
    throw new UnsupportedError(
      `playwright-core is not available or no browser binary is installed. ${INSTALL_GUIDANCE}\n(Original error: ${String(err)})`,
    );
  }
}

async function withPage<T>(
  chromium: BrowserLauncher,
  fn: (page: PageInstance) => Promise<T>,
): Promise<T> {
  const browser = await chromium.launch({ headless: true }).catch((err: unknown) => {
    throw new UnsupportedError(`${INSTALL_GUIDANCE}\n(Original error: ${String(err)})`);
  });
  const page = await browser.newPage();
  try {
    return await fn(page);
  } finally {
    await page.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

export class BrowserDataSource implements DataSource {
  private readonly importer?: PlaywrightImporter;

  constructor(opts?: BrowserDataSourceOptions) {
    this.importer = opts?.importer;
  }

  async query(url: string): Promise<string> {
    const chromium = await loadChromium(this.importer);
    return withPage(chromium, async (page) => {
      const resp = await page.goto(url, { waitUntil: "networkidle" });
      if (!resp) throw new NetworkError(`Browser navigation returned no response for ${url}`);
      const status = resp.status();
      if (status >= 400) {
        throw new NetworkError(`Browser got HTTP ${status} for ${url}`);
      }
      return page.content();
    });
  }

  async getHtml(url: string): Promise<string | null> {
    const chromium = await loadChromium(this.importer);
    return withPage(chromium, async (page) => {
      const resp = await page.goto(url, { waitUntil: "networkidle" });
      if (!resp) throw new NetworkError(`Browser navigation returned no response for ${url}`);
      const status = resp.status();
      if (status === 404) return null;
      if (status >= 400) {
        throw new NetworkError(`Browser got HTTP ${status} for ${url}`);
      }
      return page.content();
    });
  }

  async getPdf(url: string): Promise<Uint8Array> {
    const chromium = await loadChromium(this.importer);
    return withPage(chromium, async (page) => {
      const resp = await page.goto(url, { waitUntil: "networkidle" });
      if (!resp) throw new NetworkError(`Browser navigation returned no response for ${url}`);
      const status = resp.status();
      if (status === 404) throw new NotFoundError(`Not found via browser: ${url}`);
      if (status >= 400) {
        throw new NetworkError(`Browser got HTTP ${status} for ${url}`);
      }
      const buf = await page.pdf();
      return new Uint8Array(buf);
    });
  }

  async getText(url: string): Promise<string> {
    const chromium = await loadChromium(this.importer);
    return withPage(chromium, async (page) => {
      const resp = await page.goto(url, { waitUntil: "networkidle" });
      if (!resp) throw new NetworkError(`Browser navigation returned no response for ${url}`);
      const status = resp.status();
      if (status === 404) throw new NotFoundError(`Not found via browser: ${url}`);
      if (status >= 400) {
        throw new NetworkError(`Browser got HTTP ${status} for ${url}`);
      }
      return page.content();
    });
  }
}
```

Run: `npx vitest run test/core/datasource/browser.test.ts` — expect PASS.

- [ ] **Step 3: Run typecheck.**

```bash
npx tsc --noEmit
```

Expected: PASS (no errors originating in `src/core/datasource/browser.ts` or its test).

- [ ] **Step 4: Commit.**

```bash
git add src/core/datasource/browser.ts test/core/datasource/browser.test.ts
git commit -m "feat(core): add BrowserDataSource with lazy playwright-core and UnsupportedError degradation"
```

---

### Task B — `client.ts`: engage the browser on non-content failure

**Files:**
- Modify: `src/core/client.ts`
- Create: `test/core/client-browser-fallback.test.ts`

**Interfaces:**
- Consumes: `BrowserDataSource` from `./datasource/browser.js`; `NotFoundError`, `NetworkError`, `RateLimitedError`, `UnsupportedError` from `./errors.js`; `DataSource` from `./datasource/datasource.js`; the existing `getContent`/`getHtml`/`getPdf` failure propagation introduced in Phase 6.
- Produces: modified `client.ts` that (1) adds a protected factory method `makeBrowserSource(): DataSource` (override seam for tests), (2) in the `getContent` method, when `this.cfg.browserFallback` is `true` and the API-path error is a `NetworkError` or `RateLimitedError` (non-content failures — 403/exhausted retries), lazily calls `this.browser ??= this.makeBrowserSource()` and retries the SAME url through it before re-throwing; a `NotFoundError` (clean 404) is never redirected to the browser, and when `browserFallback` is `false` the error propagates immediately without constructing any browser source.

**Trigger logic — where in `getContent` to hook:**

The Phase 6 `getContent` implementation follows the source matrix:
- For `source === 'auto'` or `source === 'html'`: tries `this.api.getHtml(htmlUrl)` → on `null` (404) falls through to ar5iv → on `null` or zero-section 200 falls through to PDF.
- For PDF: calls `this.api.getPdf(pdfUrl)` → on `NotFoundError` propagates.
- Network failures (`NetworkError`/`RateLimitedError`) surface from `this.api.getHtml` as thrown exceptions and from `this.api.getPdf` likewise.

The browser hook wraps each `this.api.getHtml(url)` and `this.api.getPdf(url)` call inside `getContent` (and the shared helpers it uses) with a `catch` that inspects the error:
- If `instanceof NetworkError || instanceof RateLimitedError` AND `this.cfg.browserFallback`: retry via `this.browser.getHtml(url)` / `this.browser.getPdf(url)` using the same url.
- Otherwise: rethrow.
- Never redirect a `NotFoundError` or a successful null-return (404) to the browser.

The `makeBrowserSource` factory is `protected` so test subclasses can override it; the injected fake browser source must implement `DataSource`.

**Implementation approach — add two private helpers to `client.ts`:**

```ts
protected makeBrowserSource(): DataSource {
  return new BrowserDataSource();
}

private async htmlWithBrowserFallback(url: string): Promise<string | null> {
  try {
    return await this.api.getHtml(url);
  } catch (err) {
    if (
      this.cfg.browserFallback &&
      (err instanceof NetworkError || err instanceof RateLimitedError)
    ) {
      this.browser ??= this.makeBrowserSource();
      return this.browser.getHtml(url);
    }
    throw err;
  }
}

private async pdfWithBrowserFallback(url: string): Promise<Uint8Array> {
  try {
    return await this.api.getPdf(url);
  } catch (err) {
    if (
      this.cfg.browserFallback &&
      (err instanceof NetworkError || err instanceof RateLimitedError)
    ) {
      this.browser ??= this.makeBrowserSource();
      return this.browser.getPdf(url);
    }
    throw err;
  }
}
```

Then inside `getContent`, replace every direct `this.api.getHtml(url)` call with `this.htmlWithBrowserFallback(url)` and every `this.api.getPdf(url)` call with `this.pdfWithBrowserFallback(url)`.

- [ ] **Step 1: Write failing tests for the browser-fallback integration in the client.** Create `test/core/client-browser-fallback.test.ts`. All tests inject a fake API datasource and (where the browser path is expected) a fake browser datasource via a subclass that overrides `makeBrowserSource`. No real playwright, no network.

```ts
import { describe, it, expect, vi } from "vitest";
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
    await expect(client.getContent("2310.06825", { source: "html" })).rejects.not.toMatchObject({
      // It should throw something (UnsupportedError or similar) but NOT use the browser.
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
```

Run: `npx vitest run test/core/client-browser-fallback.test.ts` — expect FAIL (client has no `makeBrowserSource`, no fallback logic).

- [ ] **Step 2: Modify `src/core/client.ts` to add the browser-fallback seam and hook `getContent`.** Add the import, the `protected makeBrowserSource()` factory, and the two private helper methods, then update `getContent`'s internal HTML/PDF fetch calls to use the helpers.

At the top of `src/core/client.ts`, add the import (alongside the existing datasource imports):

```ts
import { BrowserDataSource } from "./datasource/browser.js";
import {
  NetworkError,
  NotFoundError,
  RateLimitedError,
} from "./errors.js";
```

(If `NetworkError`/`NotFoundError`/`RateLimitedError` are already imported, skip those duplicate imports.)

Inside the `ArxivClient` class body, add the factory and helpers after the constructor:

```ts
/** Override in tests to inject a fake browser DataSource without real playwright. */
protected makeBrowserSource(): DataSource {
  return new BrowserDataSource();
}

private async htmlWithBrowserFallback(url: string): Promise<string | null> {
  try {
    return await this.api.getHtml(url);
  } catch (err) {
    if (
      this.cfg.browserFallback &&
      (err instanceof NetworkError || err instanceof RateLimitedError)
    ) {
      this.browser ??= this.makeBrowserSource();
      return this.browser.getHtml(url);
    }
    throw err;
  }
}

private async pdfWithBrowserFallback(url: string): Promise<Uint8Array> {
  try {
    return await this.api.getPdf(url);
  } catch (err) {
    if (
      this.cfg.browserFallback &&
      (err instanceof NetworkError || err instanceof RateLimitedError)
    ) {
      this.browser ??= this.makeBrowserSource();
      return this.browser.getPdf(url);
    }
    throw err;
  }
}
```

Then inside `getContent` (Phase 6 implementation), replace all calls of the form:
- `this.api.getHtml(url)` → `this.htmlWithBrowserFallback(url)`
- `this.api.getPdf(url)` → `this.pdfWithBrowserFallback(url)`

Do NOT replace `this.api.query(url)` (search path) or `this.api.getText(url)` (bibtex path) — only the HTML/PDF content-fetch calls inside `getContent` and `download` are wrapped.

Run: `npx vitest run test/core/client-browser-fallback.test.ts` — expect PASS.

- [ ] **Step 3: Run the full test suite to confirm no regressions.**

```bash
npx vitest run
```

Expected: all previously passing tests remain green; new browser-fallback tests pass.

- [ ] **Step 4: Run typecheck.**

```bash
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/core/client.ts test/core/client-browser-fallback.test.ts
git commit -m "feat(core): engage BrowserDataSource on non-content API failures when browserFallback enabled"
```

---

### Task C — Wire `--browser` / `ARXIV_BROWSER` end to end

**Files:**
- Verify and modify if needed: `src/core/config.ts`, `src/cli/index.ts`
- Add test assertions to: `test/cli/index.test.ts`

**Interfaces:**
- `config.ts` (Phase 2): `ARXIV_BROWSER`→`browserFallback` mapping already exists (verified in `02-ids-config.md` step-by-step: `if (process.env.ARXIV_BROWSER) fromEnv.browserFallback = isTruthy(process.env.ARXIV_BROWSER)`).
- `cli/index.ts` (Phase 5): `defaultClientFactory` already sets `if (flags.browser) overrides.browserFallback = true` and `GlobalFlags.browser?: boolean` exists and is captured from `--browser` option.
- `createProgram` already adds `--browser` via `addCommonOptions` and it is merged through `mergeGlobal`.

**Gap analysis:** No wiring gap exists. Both legs are already implemented in Phases 2 and 5. This task's job is to (a) add explicit integration-style assertions to the existing CLI test that confirm the wiring is not accidentally broken, and (b) ensure the `UnsupportedError` from a missing browser binary surfaces with a clear message at the CLI level (exit code 6, not an unhandled throw).

- [ ] **Step 1: Verify the wiring is intact by running existing CLI tests.**

```bash
npx vitest run test/cli/
```

Expected: PASS. The existing `"propagates --browser and --cache-dir"` test in `test/cli/index.test.ts` already asserts `captured.flags?.browser === true` and `defaultClientFactory` already wires that into `browserFallback`. If these tests fail at this stage, investigate and fix the regression before proceeding.

- [ ] **Step 2: Add assertions that confirm `browserFallback` reaches the client.** Open `test/cli/index.test.ts` and append the following two test cases inside the existing `describe("cli index", ...)` block:

```ts
  it("defaultClientFactory sets browserFallback=true when browser flag is set", () => {
    const client = defaultClientFactory({ browser: true }) as unknown as {
      cfg: { browserFallback: boolean };
    };
    expect(client.cfg.browserFallback).toBe(true);
  });

  it("defaultClientFactory leaves browserFallback=false when browser flag is absent", () => {
    const client = defaultClientFactory({}) as unknown as {
      cfg: { browserFallback: boolean };
    };
    expect(client.cfg.browserFallback).toBe(false);
  });
```

Note: `ArxivClient.cfg` is `private readonly` in the contract. To access it in the test, cast through `unknown` (test-only introspection). If the TypeScript strict mode rejects the cast even through `unknown`, use `(client as never as { cfg: { browserFallback: boolean } })`.

Run: `npx vitest run test/cli/index.test.ts` — expect PASS.

- [ ] **Step 3: Add `UnsupportedError` graceful-degradation handling for the `--browser` flag in the CLI read command.** The `src/cli/commands/read.ts` (Phase 8) `runRead` function should already catch `ArxivError` and map it through `exitCodeFor` (exit 6 for `UnsupportedError`). Verify this is in place for Phase 8. If it is, no code change is needed here — the error will surface as:

```
Error: playwright-core is not available or no browser binary is installed.
Install one with: npx playwright install chromium
Then re-run with --browser or ARXIV_BROWSER=1.
```

with exit code 6. Add a verification note in the Phase 8 checklist (out of scope for this phase file) to confirm the `--verbose` path also prints the stack for `UnsupportedError`.

If Phase 8's `runRead` does NOT catch `ArxivError` generically and re-emit through `exitCodeFor`, add this note: the CLI bootstrap's `run()` function in `src/cli/index.ts` must catch unhandled errors from command action handlers and map them through `exitCodeFor`; add a fallback `process.on('uncaughtException', ...)` or wrap the `program.parseAsync` call in a broader catch if needed.

- [ ] **Step 4: Add `ARXIV_BROWSER` env-var integration test for config.** Append to `test/core/config.test.ts` inside the env-precedence `describe` block (the test already contains an `ARXIV_BROWSER` case — confirm it asserts both the truthy and falsy path):

```ts
  it("ARXIV_BROWSER truthy sets browserFallback true (already in Phase 2 — verify still passes)", () => {
    process.env.ARXIV_BROWSER = "1";
    expect(resolveConfig().browserFallback).toBe(true);
    process.env.ARXIV_BROWSER = "0";
    expect(resolveConfig().browserFallback).toBe(false);
    delete process.env.ARXIV_BROWSER;
    expect(resolveConfig().browserFallback).toBe(false);
  });
```

If this test already exists verbatim in `test/core/config.test.ts`, skip the addition (it was authored in Phase 2). Run:

```bash
npx vitest run test/core/config.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run the full test suite one final time.**

```bash
npx vitest run
```

Expected: all tests green (Phase 1–9 suite + new Phase 10 tests).

- [ ] **Step 6: Run typecheck.**

```bash
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git add test/cli/index.test.ts test/core/config.test.ts
git commit -m "test(cli): assert browserFallback wiring from --browser flag and ARXIV_BROWSER env through client"
```
