<!-- SHARED CONTRACTS — frozen bedrock for all plan parts. Not a phase; a reference. -->
<!-- Every plan-writer embeds the relevant slices of this verbatim so the parts stay type-consistent. -->

# Shared Contracts (frozen)

These are the canonical signatures every phase must build against. Phase 1 (scaffold)
**creates** `types.ts` and `errors.ts` with exactly the content below. Phase 4 **creates**
`datasource/datasource.ts`, `datasource/api.ts`, and `client.ts` with exactly the skeleton
below. Later phases **modify** `client.ts` only by filling the method bodies that Phase 4
left as `// implemented in Phase N` stubs — never by restructuring the constructor or the
field set.

## 1. `src/core/types.ts` (Phase 1 — frozen, transcribe verbatim)

```ts
export interface Author {
  name: string;
  affiliation?: string;
}

export interface Paper {
  id: string;
  version?: number;
  idWithVersion?: string;
  title: string;
  summary: string;
  authors: Author[];
  categories: string[];
  primaryCategory: string;
  published: string;
  updated: string;
  doi?: string;
  journalRef?: string;
  comment?: string;
  links: { abs: string; pdf: string; html?: string };
}

export interface SearchParams {
  query?: string;
  title?: string;
  author?: string;
  abstract?: string;
  category?: string;
  ids?: string[];
  start?: number;
  maxResults?: number;
  sortBy?: "relevance" | "submittedDate" | "lastUpdatedDate";
  sortOrder?: "ascending" | "descending";
}

export interface SearchResult {
  total: number;
  start: number;
  count: number;
  papers: Paper[];
  hints?: string[];
}

export interface Section {
  id?: string;
  title: string;
  level: number;
  content: string;
}

export interface PaperContent {
  id: string;
  version?: number;
  source: "html-native" | "html-ar5iv" | "pdf";
  format: "markdown" | "text";
  title: string;
  abstract?: string;
  sections: Section[];
  text: string;
  truncated: boolean;
  nextCursor?: string;
  warnings?: string[];
}

export interface ReadOptions {
  source?: "auto" | "html" | "pdf";
  format?: "markdown" | "text";
  section?: string;
  maxChars?: number;
  cursor?: string;
}

export interface DownloadOptions {
  type?: "pdf";
  dir?: string;
}

export interface ArxivConfig {
  cacheDir: string;
  downloadsDir: string;
  configDir: string;
  rateMs: number;
  userAgent: string;
  contact?: string;
  noCache: boolean;
  defaultMaxResults: number;
  browserFallback: boolean;
}

export interface NormalizedId {
  id: string;
  version?: number;
  idWithVersion?: string;
}
```

## 2. `src/core/errors.ts` (Phase 1 — frozen, transcribe verbatim)

```ts
export type ArxivErrorCode =
  | "GENERIC"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "NETWORK"
  | "PARSE"
  | "UNSUPPORTED";

export class ArxivError extends Error {
  readonly code: ArxivErrorCode;
  constructor(message: string, code: ArxivErrorCode = "GENERIC") {
    super(message);
    this.name = new.target.name;
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class NotFoundError extends ArxivError {
  constructor(message: string) {
    super(message, "NOT_FOUND");
  }
}

export class RateLimitedError extends ArxivError {
  constructor(message: string) {
    super(message, "RATE_LIMITED");
  }
}

export class NetworkError extends ArxivError {
  constructor(message: string) {
    super(message, "NETWORK");
  }
}

export class ParseError extends ArxivError {
  constructor(message: string) {
    super(message, "PARSE");
  }
}

export class UnsupportedError extends ArxivError {
  constructor(message: string) {
    super(message, "UNSUPPORTED");
  }
}

/** Stable CLI exit codes (spec §11). */
export function exitCodeFor(err: unknown): number {
  if (err instanceof ArxivError) {
    switch (err.code) {
      case "NOT_FOUND":
        return 2;
      case "RATE_LIMITED":
        return 3;
      case "NETWORK":
        return 4;
      case "PARSE":
        return 5;
      case "UNSUPPORTED":
        return 6;
      default:
        return 1;
    }
  }
  return 1;
}
```

## 3. `src/core/datasource/datasource.ts` (Phase 4 — frozen interface)

The DataSource is a thin transport seam (spec §3.1, CLAUDE.md). It builds nothing and
parses nothing; the client builds URLs and decides fallback order.

```ts
export interface DataSource {
  /** GET an Atom feed (the /api/query endpoint); returns the XML text. */
  query(url: string): Promise<string>;
  /** GET an HTML page; resolves to `null` on HTTP 404 (drives the source-fallback matrix). */
  getHtml(url: string): Promise<string | null>;
  /** GET PDF bytes; throws NotFoundError on 404. */
  getPdf(url: string): Promise<Uint8Array>;
  /** GET arbitrary text (e.g. the bibtex endpoint); throws NotFoundError on 404. */
  getText(url: string): Promise<string>;
}
```

`ApiDataSource` (Phase 4) wraps `Http` (Phase 3, `getText(url): Promise<string|null>`,
`getBytes(url): Promise<Uint8Array>`):
- `query(url)` → `http.getText(url)`; if `null`, throw `NetworkError`.
- `getHtml(url)` → `http.getText(url)` (passes the `null` through).
- `getPdf(url)` → `http.getBytes(url)`.
- `getText(url)` → `http.getText(url)`; if `null`, throw `NotFoundError`.

`BrowserDataSource` (Phase 10) implements the same interface over lazy `playwright-core`.

## 4. `src/core/client.ts` skeleton (Phase 4 creates; Phases 6/7/10 fill stubs)

Phase 4 creates this exact constructor and field set. The cache is **client-level and
structured** (spec §8): `Http` is constructed **without** a cache; the client keys the cache
by the structured tuples in spec §8. Later phases add method bodies where marked but never
change the constructor wiring or fields.

```ts
import { resolveConfig } from "./config.js";
import { RateLimiter } from "./rate-limit.js";
import { Cache } from "./cache.js";
import { Http } from "./http.js";
import { ApiDataSource } from "./datasource/api.js";
import type { DataSource } from "./datasource/datasource.js";
import type {
  ArxivConfig,
  SearchParams,
  SearchResult,
  Paper,
  PaperContent,
  ReadOptions,
  DownloadOptions,
} from "./types.js";

export class ArxivClient {
  private readonly cfg: ArxivConfig;
  private readonly cache?: Cache;
  private readonly http: Http;
  private readonly api: DataSource;
  private browser?: DataSource; // lazily constructed in Phase 10 when browserFallback engages

  constructor(config?: Partial<ArxivConfig>) {
    this.cfg = resolveConfig(config);
    const limiter = new RateLimiter(this.cfg.rateMs);
    this.cache = this.cfg.noCache ? undefined : new Cache(this.cfg.cacheDir);
    this.http = new Http(this.cfg, limiter); // structured caching is at the client level
    this.api = new ApiDataSource(this.http);
  }

  // Phase 4:
  async search(params: SearchParams): Promise<SearchResult> { /* … */ }
  async getPaper(id: string): Promise<Paper> { /* … */ }
  async getPapers(ids: string[]): Promise<Paper[]> { /* … */ }
  async recent(category: string, opts?: { maxResults?: number }): Promise<SearchResult> { /* … */ }

  // Phase 6:
  async getContent(id: string, opts?: ReadOptions): Promise<PaperContent> { /* Phase 6 */ }
  async download(id: string, opts?: DownloadOptions): Promise<{ path: string; bytes: number }> { /* Phase 6 */ }

  // Phase 7:
  async toBibTeX(id: string): Promise<string> { /* Phase 7 */ }
}
```

## 5. Phase → file create/modify map

| File | Created in | Modified in |
|---|---|---|
| `src/core/types.ts`, `src/core/errors.ts` | Phase 1 | — |
| `package.json`, `tsconfig.json`, `tsdown.config.ts`, `vitest.config.ts`, `src/index.ts` | Phase 1 | Phase 11 (packaging finalize) |
| `src/core/ids.ts`, `src/core/config.ts` | Phase 2 | — |
| `src/core/rate-limit.ts`, `src/core/cache.ts`, `src/core/http.ts` | Phase 3 | — |
| `src/core/datasource/datasource.ts`, `src/core/datasource/api.ts` | Phase 4 | — |
| `src/core/parse/atom.ts` | Phase 4 | — |
| `src/core/client.ts` | Phase 4 (skeleton + search/getPaper(s)/recent) | Phase 6 (getContent, download), Phase 7 (toBibTeX), Phase 10 (browser engage) |
| `src/core/parse/html-common.ts`, `html-native.ts`, `html-ar5iv.ts`, `pdf.ts` | Phase 6 | — |
| `src/core/bibtex.ts` | Phase 7 | — |
| `src/cli/commands/search.ts`, `src/cli/index.ts` | Phase 5 | Phase 8 (register get/read/recent/download/cache) |
| `src/cli/commands/{get,read,recent,download,cache}.ts` | Phase 8 | — |
| `src/mcp/server.ts`, `src/mcp/index.ts` | Phase 9 | — |
| `src/core/datasource/browser.ts` | Phase 10 | — |

## 6. Cross-phase decisions (frozen — do not re-litigate per phase)

- **`getPaper`/`getPapers` are fully built in Phase 4** (incl. ≤50 batching, input order, omitted-id
  warning). Phase 7 is **BibTeX only** (`bibtex.ts` + `client.toBibTeX`); it does not re-touch
  `getPaper(s)`.
- **`client.download` is built in Phase 6** (it shares the PDF datasource + `filenameFor`/`pdfUrl`
  from `ids.ts`): fetch `getPdf(pdfUrl(n))`, `fs.mkdir(dir,{recursive:true})`, write
  `join(dir, filenameFor(n))`, return `{ path, bytes }`, print nothing (the CLI prints the path).
  `dir` precedence: `opts.dir` → `cfg.downloadsDir`.
- **Structured cache keys (spec §8), all at client level:** search → `{kind:"search", paramsHash}`
  TTL 1h; metadata → `{kind:"meta", id, version}` TTL ∞ if versioned else 24h; content →
  `{kind:"content", id, version, source}` TTL ∞ if versioned else 24h. `--no-cache`/`noCache`
  ⇒ `this.cache` is `undefined`, so every method must guard `this.cache?.get(...)`.
- **Cursor (Phase 6):** opaque base64 of `{ id, version, source, sectionIndex, charOffset: 0 }`;
  decode validates the caller-supplied `id` matches → else `ParseError`. `nextCursor` present iff
  more sections remain; `truncated` true iff the read was chunked at all.
- **Browser fallback (Phase 10):** engaged only when `cfg.browserFallback` is true AND the API
  path failed for a **non-content** reason (403/challenge, or exhausted 5xx/connection/TLS) — never
  on a clean 404. Lazy `import("playwright-core")`; if no browser binary, throw `UnsupportedError`
  with install guidance; the API path is never broken by the browser path's absence.
- **`src/index.ts`** re-exports the public surface: `ArxivClient`, all `types.ts` types, all
  `errors.ts` classes + `exitCodeFor`, and `normalizeId` from `ids.ts`.
