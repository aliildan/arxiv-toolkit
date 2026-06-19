# arXiv Toolkit — Design Spec

- **Date:** 2026-06-19
- **Status:** Approved design (revised after adversarial review), pending implementation plan
- **Author:** brainstorming session (Claude Code, ultracode)
- **Working name:** `arxiv-toolkit` (npm name provisional — verify availability at implementation time)

A TypeScript library exposed as both a **CLI** (`arxiv`) and an **MCP server** (`arxiv-mcp`)
for searching arXiv, fetching metadata, and reading papers (HTML → Markdown, with PDF
fallback) — built API-first on arXiv's official endpoints, with a browser fallback behind a
swappable interface (off by default, used only when the official endpoints fail).

All technical specifics were verified against live sources on 2026-06-19 (see
[§20 References](#20-references)); library versions are the latest published as of that date.
This revision incorporates fixes from a 5-lens adversarial review (completeness, consistency,
ambiguity, scope, technical correctness).

---

## 1. Goals

1. **Search & discovery** — full-text and field-scoped search (title, author, abstract,
   category), boolean queries, date sorting, pagination, and a "recent in a category" listing.
2. **Read full text** — fetch a paper's content as clean, **section-aware** Markdown (or plain
   text): prefer native arXiv HTML, fall back to ar5iv, fall back to PDF text extraction.
   **Chunkable** so an LLM can read large papers within a context budget.
3. **Metadata & export** — rich metadata for one or many IDs and citation export (BibTeX).
4. **One core, two faces** — a single tested `core` library powers the CLI and MCP server as
   thin adapters.
5. **Polite & portable** — respect arXiv's rate-limit etiquette, cache aggressively, persist
   downloads in OS-native locations, require no browser to function.

## 2. Non-goals (YAGNI)

- **Citation graph / "who cites whom"** — needs an external source (Semantic Scholar); out of scope.
- **LaTeX source (`e-print`) download & figure extraction** — out of scope. (`DownloadOptions.type`
  is therefore intentionally constrained to `'pdf'`; it is not a v1/v2 sequencing placeholder.)
- **Bulk harvesting** (OAI-PMH, AWS S3 `s3://arxiv`, Kaggle) — README pointers only ([§5.4](#54-bulk-access-pointers-out-of-scope)).
- **Writing/submitting to arXiv** — read-only.
- **Long-running daemon / HTTP MCP transport** — stdio only for v1.
- **Browser scraping as the *primary* data path** — the browser fallback is a secondary path
  behind the `DataSource` seam, **off by default**, used only when the official endpoints fail
  ([§7.2](#72-read-full-text)).

## 3. Architecture

### 3.1 Layering

```
┌────────────────────┐     ┌────────────────────┐
│   CLI adapter      │     │   MCP adapter      │   ← thin: parse input, call core,
│   (commander)      │     │   (MCP SDK, stdio) │     format output. No arXiv logic.
└─────────┬──────────┘     └─────────┬──────────┘
          └───────────┬──────────────┘
                      ▼
            ┌───────────────────┐
            │   ArxivClient     │   ← ids → cache → rate-limit → datasource → parse
            └─────────┬─────────┘
        ┌─────────────┼───────────────┬──────────────┐
        ▼             ▼               ▼              ▼
   DataSource     cache.ts       rate-limit.ts    parse/*
   (interface)   (fs + TTL)     (min-interval)   (atom/html/pdf)
   ├─ ApiDataSource     (official endpoints — default)
   └─ BrowserDataSource (lazy playwright-core — fallback, off by default)
```

**Rule:** `core` has no dependency on `commander` or the MCP SDK. Adapters depend only on
`ArxivClient`'s public surface. The `DataSource` interface is the single seam where the data
source is chosen; v1 ships both `ApiDataSource` (default) and `BrowserDataSource` (fallback).

> **On the "browser fallback":** `BrowserDataSource` (lazy-imported `playwright-core`) is **off by
> default** and engaged only when `ApiDataSource` fails for a non-content reason (see [§7.2](#72-read-full-text)).
> It fetches the **same** native/ar5iv/PDF/abs URLs and reuses the existing parsers, emitting the
> same `PaperContent.source` values (no new enum value). If no browser binary is available it
> degrades gracefully (clear error with install guidance) and never breaks the API path. The
> browsirai / chrome-devtools MCP servers were design-time investigation aids only, not runtime
> dependencies.

### 3.2 Project file tree

```
arxiv-toolkit/
├─ package.json                 # type:module, engines.node >=20.19 (build needs >=22.18, see §14/§16), 2 bins, exports map
├─ tsconfig.json                # module/moduleResolution: NodeNext, target ES2022 (relative imports carry .js)
├─ tsdown.config.ts             # entries: index (lib), cli, mcp; esm; dts; bin shebang via tsdown bin config
├─ vitest.config.ts
├─ README.md
├─ src/
│  ├─ index.ts                  # public library entry (re-exports core)
│  ├─ core/
│  │  ├─ types.ts               # Paper, Author, SearchParams, SearchResult, Section, PaperContent, ReadOptions, DownloadOptions, ArxivConfig
│  │  ├─ ids.ts                 # normalize/parse arXiv ids + versions + URLs
│  │  ├─ config.ts              # resolveConfig(): ArxivConfig (paths via env-paths, rate, UA) with precedence
│  │  ├─ errors.ts              # ArxivError subclasses + codes
│  │  ├─ http.ts                # fetch wrapper: UA header, timeout, retry/backoff, through limiter
│  │  ├─ rate-limit.ts          # per-host min-interval limiter
│  │  ├─ cache.ts               # filesystem cache (key hash + sidecar TTL)
│  │  ├─ client.ts              # ArxivClient (orchestrator)
│  │  ├─ bibtex.ts              # fetch canonical + generate @misc fallback
│  │  ├─ datasource/
│  │  │  ├─ datasource.ts       # DataSource interface
│  │  │  ├─ api.ts              # ApiDataSource (default)
│  │  │  └─ browser.ts          # BrowserDataSource (lazy playwright-core — fallback, off by default)
│  │  └─ parse/
│  │     ├─ atom.ts             # Atom feed → Paper[] + paging info
│  │     ├─ html-native.ts      # arxiv.org/html (ltx_* schema) → sections
│  │     ├─ html-ar5iv.ts       # ar5iv (legacy schema) → sections
│  │     ├─ html-common.ts      # shared section→Markdown (turndown + gfm + math/footnote rules), used by both HTML branches
│  │     └─ pdf.ts              # unpdf text extraction + best-effort single-section split + cleanup
│  ├─ cli/
│  │  ├─ index.ts               # #!/usr/bin/env node — commander program
│  │  └─ commands/              # search.ts, get.ts, read.ts, download.ts, recent.ts, cache.ts
│  └─ mcp/
│     ├─ index.ts               # #!/usr/bin/env node — boots stdio server
│     └─ server.ts              # McpServer + registerTool
└─ test/
   ├─ fixtures/                 # real Atom/HTML(native+ar5iv)/PDF samples
   └─ *.test.ts
```

## 4. Domain model (`core/types.ts`)

```ts
interface Author { name: string; affiliation?: string }

interface Paper {
  id: string;                 // canonical, no version, e.g. "2310.06825" or "cond-mat/0011267"
  version?: number;           // resolved version if known, e.g. 1
  idWithVersion?: string;     // e.g. "2310.06825v1" (present iff version known)
  title: string;
  summary: string;            // abstract
  authors: Author[];
  categories: string[];       // all incl. cross-lists, e.g. ["cs.CL","cs.AI","cs.LG"]
  primaryCategory: string;    // e.g. "cs.CL"
  published: string;          // ISO — date v1 was submitted
  updated: string;            // ISO — date the resolved version was submitted
  doi?: string;
  journalRef?: string;
  comment?: string;
  links: { abs: string; pdf: string; html?: string };  // html present only if known-available
}

interface SearchParams {
  query?: string;             // free text → emitted as all:<query>, ANDed with any field clauses (§7.1)
  title?: string; author?: string; abstract?: string; category?: string;
  ids?: string[];             // id_list filter
  start?: number;             // 0-based, default 0
  maxResults?: number;        // default 25 (or ARXIV_MAX_RESULTS); clamped to ≤ 2000 (§5.1)
  sortBy?: 'relevance' | 'submittedDate' | 'lastUpdatedDate';   // default relevance
  sortOrder?: 'ascending' | 'descending';                       // default descending
}

interface SearchResult {
  total: number;              // opensearch:totalResults
  start: number;              // opensearch:startIndex
  count: number;              // opensearch:itemsPerPage (this page)
  papers: Paper[];
  hints?: string[];           // e.g. "1.2M results — narrow by category/date" when total > 1000 (§7.1)
}

interface Section {
  id?: string;                // stable anchor when available, e.g. "S1", "S1.SS1"
  title: string;
  level: number;              // 1 = section, 2 = subsection, …
  content: string;            // content in PaperContent.format (markdown or plain text)
}

interface PaperContent {
  id: string;                 // resolved canonical id this content is for
  version?: number;           // resolved version (the cursor is bound to id+version+source)
  source: 'html-native' | 'html-ar5iv' | 'pdf';
  format: 'markdown' | 'text';
  title: string;
  abstract?: string;
  sections: Section[];        // the chunk's sections (whole sections; never split — §7.2)
  text: string;               // this chunk's sections concatenated, in `format`
  truncated: boolean;         // true iff this response is one chunk of a chunked read
  nextCursor?: string;        // AUTHORITATIVE "more remains" signal: present iff more content follows
  warnings?: string[];        // e.g. "ar5iv fallback used", "suspected broken LaTeXML conversion"
}

interface ReadOptions {
  source?: 'auto' | 'html' | 'pdf';   // §7.2 fallback matrix; default 'auto'
  format?: 'markdown' | 'text';        // default 'markdown'
  section?: string;                    // return one section (match rules in §7.2); wins over maxChars
  maxChars?: number;                   // soft chunk target; snaps to whole-section boundaries
  cursor?: string;                     // opaque continuation; must be used with the same id
}

interface DownloadOptions { type?: 'pdf'; dir?: string }   // type fixed to 'pdf' in v1 (§2)

interface ArxivConfig {
  cacheDir: string;           // default env-paths('arxiv-toolkit',{suffix:''}).cache
  downloadsDir: string;       // default <data>/papers
  configDir: string;          // default env-paths(...).config
  rateMs: number;             // min-interval per host, default 3000
  userAgent: string;          // resolved UA string (§9)
  contact?: string;           // mailto used to build UA if userAgent not overridden
  noCache: boolean;           // default false
  defaultMaxResults: number;  // default 25 (from ARXIV_MAX_RESULTS); the 2000 clamp is a fixed constant, not this
  browserFallback: boolean;   // default false — engage BrowserDataSource when ApiDataSource fails (§7.2)
}
```

`config.json` (in `configDir`) is a `Partial<ArxivConfig>` JSON file; recognized keys are the
`ArxivConfig` fields above; unknown keys are ignored. Env vars override file values ([§10](#10-configuration--paths-coreconfigts)).

## 5. arXiv endpoint reference (verified 2026-06-19)

### 5.1 Query API — search & metadata

- **Base URL:** `https://export.arxiv.org/api/query` (always HTTPS; `http://` 301-redirects).
- **Parameters:** `search_query`; `id_list` (comma-separated; may combine with `search_query`);
  `start` (0-based, default 0); `max_results` (API default 10).
- **Result-count limits:** the **API hard cap is `max_results` ≤ 30000** (over-limit → server
  error). arXiv's **recommended slice is ≤ 2000**. The toolkit **always sends `max_results`**
  (so the API's default of 10 never applies) and **clamps every request to ≤ 2000** as a
  politeness guard (a fixed constant, not configurable). "Hard cap" = 30000 (arXiv); "clamp" =
  2000 (toolkit).
- **Field prefixes:** `ti`, `au`, `abs`, `co`, `jr`, `cat`, `rn`, `id`, `all`. Syntax `prefix:term`.
- **Boolean:** `AND`, `OR`, `ANDNOT` (uppercase; `ANDNOT` is arXiv-specific exclusion, not generic
  `NOT`). URL-encode grouping/quoting: `(`→`%28`, `)`→`%29`, `"`→`%22`, space→`+`. Multi-word
  terms are wrapped in `%22…%22`. The builder emits pre-encoded `search_query`.
- **Sorting:** `sortBy` ∈ {`relevance`,`lastUpdatedDate`,`submittedDate`}; `sortOrder` ∈
  {`ascending`,`descending`}. Default order is relevance.
- **Response:** Atom 1.0. Namespaces: Atom `http://www.w3.org/2005/Atom` (default), OpenSearch
  `http://a9.com/-/spec/opensearch/1.1/`, arXiv `http://arxiv.org/schemas/atom`.
- **Pagination:** `opensearch:totalResults/startIndex/itemsPerPage`. Page by incrementing `start`
  by `maxResults`; stop when `start >= total`. **Deep paging is unreliable** (large `start` → 5xx)
  — for big sets, narrow the query instead.
- **Entry fields:** `id` (abs URL incl. version), `title`, `summary`, `published`, `updated`,
  `author/name` (+ `arxiv:affiliation?`), `category[@term]` (0+), `arxiv:primary_category`,
  `arxiv:comment?`, `arxiv:journal_ref?`, `arxiv:doi?`, `link[rel=alternate type=text/html]` (abs),
  `link[rel=related title=pdf]` (PDF), optional `link[rel=related title=doi]`.
  `published` = v1 date; `updated` = resolved-version date.

### 5.2 Content endpoints — reading

| Purpose | URL pattern | Coverage / notes |
|---|---|---|
| Native HTML | `https://arxiv.org/html/{id}` and `…/{id}v{n}` | **Post-Dec-2023 LaTeX-sourced only.** 404 for historical / PDF-only. LaTeXML `ltx_*` classes. |
| ar5iv HTML (fallback) | `https://ar5iv.labs.arxiv.org/html/{id}` | Historical TeX corpus (~90%). **Older schema** (bare `h1`/`h2`, `class="title mathjax"`). Third-party Labs — best-effort. |
| PDF (universal fallback) | `https://arxiv.org/pdf/{id}` (+ optional `v{n}`, optional `.pdf`) | All IDs incl. old-style. `Content-Type: application/pdf`. |
| Abstract page | `https://arxiv.org/abs/{id}` | Always available; has `[v1]/[v2]…` markers + submission history. |
| BibTeX (official) | `https://arxiv.org/bibtex/{id}` | Canonical `@misc` BibTeX ([§7.3](#73-metadata--export)). |

**Native HTML (`ltx_*`):** title `h1.ltx_title_document`; abstract `section.ltx_abstract`
(heading `h6.ltx_title_abstract`); sections `section.ltx_section` (`h2.ltx_title_section`, id `S1`);
subsections `section.ltx_subsection` (`h3.ltx_title_subsection`, id `S1.SS1`); bibliography
`section#bib.ltx_bibliography`. **ar5iv** (separate branch): title `h1.title.mathjax`; bare
`h1`/`h2`. A single selector set will **not** parse both — `html-native.ts` and `html-ar5iv.ts`
are distinct branches feeding the shared `html-common.ts` converter.

### 5.3 arXiv ID normalization (`core/ids.ts`)

- **New style:** `^\d{4}\.\d{4,5}$` (e.g. `2310.06825`). **Old style:**
  `^[a-z\-]+(\.[A-Z]{2})?/\d{7}$` (e.g. `cond-mat/0011267`, `math.GT/0309136`). Optional `(v\d+)?`.
- Accept URL inputs (`/abs/`,`/html/`,`/pdf/`, ar5iv hosts) and strip the path prefix.
- **Keep the literal slash** in old-style IDs in URLs (do **not** `%2F`-encode).
- **On-disk filenames** replace the slash with `_`: `cond-mat/0011267` → `cond-mat_0011267[v{n}].pdf`
  (the URL keeps the slash; only the filename is sanitized).
- Bare-ID URLs resolve to the latest version; pin `v{n}` for reproducibility. A non-existent
  version 404s.

### 5.4 Bulk access pointers (out of scope)

README-only: OAI-PMH (`https://oaipmh.arxiv.org/oai`), AWS S3 requester-pays `s3://arxiv`
(`pdf/`, `src/` + manifests), Kaggle Cornell-University/arxiv dump.

## 6. Core client API (`core/client.ts`)

```ts
class ArxivClient {
  constructor(config?: Partial<ArxivConfig>);   // merged over resolved defaults (§10)
  search(params: SearchParams): Promise<SearchResult>;
  getPaper(id: string): Promise<Paper>;
  getPapers(ids: string[]): Promise<Paper[]>;            // id_list, batched ≤ 50/request, input order
  getContent(id: string, opts?: ReadOptions): Promise<PaperContent>;
  download(id: string, opts?: DownloadOptions): Promise<{ path: string; bytes: number }>;
  toBibTeX(id: string): Promise<string>;
  recent(category: string, opts?: { maxResults?: number }): Promise<SearchResult>;
}
```

- **`getPapers`** chunks `ids` into ≤ 50 per `id_list` request, returns `Paper[]` in input order;
  IDs arXiv does not return are omitted and listed in a per-call warning (no throw for batch).
- **`download`** is single-ID; the CLI's variadic `download <id...>` loops it (§12).
- Every outbound request flows through `core/http.ts` → rate limiter → retry/backoff; reads write
  through `core/cache.ts`.

## 7. Capability specs

### 7.1 Search & discovery
- Build `search_query`: `query` (if given) → `all:"<query>"`, **ANDed** with any field-scoped
  clauses (`ti:`,`au:`,`abs:`,`cat:`). If neither `query` nor any field is given → usage error.
  Apply `id_list`, `start`, `maxResults` (clamp ≤ 2000), `sortBy`, `sortOrder`.
- Parse Atom (`parse/atom.ts`) → `SearchResult` from OpenSearch fields.
- `recent(category)` = `search({ category, sortBy:'submittedDate', sortOrder:'descending' })`.
- If `total > 1000`, push a string onto `SearchResult.hints` ("narrow by category/date"); never
  auto-deep-page. The CLI prints `hints` to stderr (suppressed by `--quiet`); the MCP
  `arxiv_search` includes them in `structuredContent`.

### 7.2 Read full text
- **Source matrix** (`ReadOptions.source`):
  - `auto` (default) — native HTML → ar5iv → PDF.
  - `html` — native HTML → ar5iv only; if **both** fail → `UnsupportedError` (never PDF).
  - `pdf` — PDF only (skip HTML).
- **Fallback triggers:** `5xx`/`429` are retried first (§9); a step falls through only after
  retries are exhausted. native→ar5iv on **HTTP 404**. ar5iv→PDF on **{404, network error, or a
  200 that parses to zero sections}**.
- **abs page is fetched in exactly two cases:** (a) a caller-pinned `v{n}` 404s (fetch abs to
  discover max version, then retry), and (b) `toBibTeX` generation fallback needs version/year.
  Unversioned `getContent`/`getPaper` do **not** fetch abs; `version` is recorded from the content
  endpoint/Atom entry if present, else left `undefined`.
- **HTML path:** parse with `linkedom`, segment by section (native `ltx_*` vs ar5iv branch),
  convert each section via `html-common.ts` (`turndown` + `turndown-plugin-gfm`) with custom rules:
  **math** (`keep()`/`addRule` for `<math>`/`<semantics>` so `$…$`/`$$…$$` LaTeX survives),
  **footnotes/bibliography** (`<sup>` links, `section.ltx_bibliography`), **tables** (GFM plugin).
- **PDF path:** `unpdf` `extractText` → cleanup (de-hyphenate, collapse whitespace). **v1 behavior:
  PDF yields a single best-effort section** (no heading heuristics invested); mark a `warning`.
- **Chunking & cursor (the central read mechanism):**
  - If `section` is set, it **wins** (`maxChars` ignored): return the matching section. Match is
    **case-insensitive**, first against `Section.id` (e.g. `S1`), then a substring match on
    `Section.title`; **zero matches → `NotFoundError`** (message lists available titles);
    **multiple → first by document order** + a `warning` naming the others.
  - Otherwise `maxChars` is a **soft target**: chunks contain **whole sections only** (never
    split a section); sections accumulate until adding the next would exceed `maxChars`. A single
    section larger than `maxChars` is returned whole.
  - The **cursor is bound to the resolved `{id, version, source}`** and encodes
    `{id, version, source, sectionIndex}` (opaque base64; `charOffset` reserved = 0 in v1 since
    chunks are section-granular). Callers MUST pass the cursor back with the **same `id`**; an
    `id` mismatch → `ParseError`. The cursor pins `version`, so a newer published version is
    ignored mid-read. If the cached full content was evicted, it is simply re-fetched (a cache
    miss, transparent to the caller).
  - `nextCursor` is the **authoritative** "more remains" signal: present iff more sections
    follow. `truncated` is `true` iff the read was returned in chunks at all.
- **Browser fallback** (`config.browserFallback`, `--browser`, `ARXIV_BROWSER=1`; default off):
  when enabled, a `BrowserDataSource` (lazy `playwright-core`) retries the **same** URL after
  `ApiDataSource` fails for a **non-content** reason — a non-retryable block (e.g. `403`/challenge),
  or repeated `5xx`/connection/TLS failure after retries are exhausted. It is **not** triggered by
  a clean `404` (that is a legitimate "not available here" → continue the source matrix). The
  browser loads the page, hands the rendered HTML/PDF bytes to the same parsers, and yields the
  same `source` value. If no browser binary is installed, it raises `UnsupportedError` with
  install guidance and the API path is unaffected.

### 7.3 Metadata & export
- `getPaper`/`getPapers`: Query API via `id_list` → `Paper`.
- `toBibTeX(id)`: **fetch `https://arxiv.org/bibtex/{id}`** (canonical). On failure/offline,
  **generate** from cached `Paper`:
  ```bibtex
  @misc{<key>,
        title={<title>},
        author={<A and B and C>},
        year={<year from published>},
        eprint={<bare id; slash kept for old-style>},
        archivePrefix={arXiv},
        primaryClass={<primaryCategory>},
        url={https://arxiv.org/abs/<id>},
  }
  ```
  Add `doi={…}` when present. **Key** = `<firstAuthorLast><year><firstTitleWord>`, where
  `firstAuthorLast` = last whitespace token of `authors[0].name`, `year` = 4-digit year of
  `published`, `firstTitleWord` = first alphabetic token of `title`, lowercased, non-alphanumerics
  stripped; the key is emitted lowercase. **Note:** the generated key is best-effort and may not
  byte-match arXiv's canonical key (e.g. canonical may append a second title token); collisions
  are accepted. Always emit `eprint`+`archivePrefix`+`primaryClass` so the `arXiv:` prefix renders.

## 8. Caching (`core/cache.ts`)

- **Location:** `config.cacheDir` (default `env-paths('arxiv-toolkit',{suffix:''}).cache`). Created
  with `fs.mkdir(..., {recursive:true})` (env-paths does not create dirs).
- **Entries & keys** (hash of the tuple; content file + sidecar `{fetchedAt, ttl, key}`):
  - search → `{kind:'search', normalizedParamsHash}`
  - metadata → `{kind:'meta', id, version}`
  - content → `{kind:'content', id, version, source}` — the **full extracted content** (all
    sections) is cached once per tuple; `format`/`section`/`maxChars`/cursor views are computed
    **in-memory** from it (chunks are **not** separately keyed). A hit for one `source` does **not**
    satisfy a request for a different `source`.
  - `version` in keys is the resolved numeric version once known; for an unversioned "latest"
    request whose version is not yet resolved, key by `id` with the latest-TTL below.
- **TTL by mutability:** versioned id → permanent (immutable); unversioned/latest → 24h; search → 1h.
- `--no-cache` / `ARXIV_NO_CACHE` bypass read+write. `arxiv cache clear` empties it; `arxiv cache
  path` prints the dir.

## 9. Rate limiting & retries

- **Limiter:** per-host **min-interval** (default **3000 ms**, `ARXIV_RATE_MS`), keyed by **exact
  hostname** — `export.arxiv.org`, `arxiv.org`, `ar5iv.labs.arxiv.org` are independent buckets.
  **Cache hits and read-bypasses do not acquire the limiter.**
- **Retries:** exponential backoff + jitter on `429`/`5xx`/network errors (arXiv returns `500`/`503`
  under load, not the documented `400`). Honor `Retry-After`. Capped retries → `RateLimitedError`
  / `NetworkError`.
- **User-Agent:** resolved as `arxiv-toolkit/<version> (+<repoUrl>; mailto:<contact>)` where
  `<version>` is injected from `package.json` at build, `<repoUrl>` from `package.json.repository`,
  `<contact>` from `ARXIV_CONTACT` (else `package.json.author.email`). If no contact is available,
  the `mailto` segment is omitted: `arxiv-toolkit/<version> (+<repoUrl>)`. `ARXIV_USER_AGENT`
  overrides the entire string.

## 10. Configuration & paths (`core/config.ts`)

- **Paths via `env-paths('arxiv-toolkit', { suffix: '' })`** → `{ data, config, cache, log, temp }`.
  Downloads default to `<data>/papers`.

  | | macOS | Linux | Windows |
  |---|---|---|---|
  | cache | `~/Library/Caches/arxiv-toolkit` | `$XDG_CACHE_HOME` or `~/.cache/arxiv-toolkit` | `%LOCALAPPDATA%\arxiv-toolkit\Cache` |
  | config | `~/Library/Preferences/arxiv-toolkit` | `$XDG_CONFIG_HOME` or `~/.config/arxiv-toolkit` | `%APPDATA%\arxiv-toolkit\Config` |
  | data/downloads | `~/Library/Application Support/arxiv-toolkit/papers` | `$XDG_DATA_HOME` or `~/.local/share/arxiv-toolkit/papers` | `%LOCALAPPDATA%\arxiv-toolkit\Data\papers` |

- **Precedence:** CLI flag → env var → config file (`<config>/config.json`, a `Partial<ArxivConfig>`)
  → default. `resolveConfig()` returns a fully-populated `ArxivConfig`.
- **Env vars → `ArxivConfig` fields:** `ARXIV_CACHE_DIR`→`cacheDir`, `ARXIV_DOWNLOADS_DIR`→
  `downloadsDir`, `ARXIV_RATE_MS`→`rateMs`, `ARXIV_USER_AGENT`→`userAgent`, `ARXIV_CONTACT`→
  `contact`, `ARXIV_NO_CACHE`→`noCache`, `ARXIV_MAX_RESULTS`→`defaultMaxResults` (the value used
  when `maxResults` is omitted; **distinct** from the fixed 2000 clamp and arXiv's own default of 10),
  `ARXIV_BROWSER`→`browserFallback`.
- On every download, **print the absolute saved path**.

## 11. Error handling (`core/errors.ts`)

- Base `ArxivError` with stable `code`; subclasses: `NotFoundError`, `RateLimitedError`,
  `NetworkError`, `ParseError`, `UnsupportedError`.
- **CLI exit codes** (stable for scripting): `0` ok; `1` generic/usage; `2` NotFound; `3`
  RateLimited; `4` Network; `5` Parse; `6` Unsupported. `--verbose` prints the stack; `--json`
  emits an error envelope `{ error: { code, message } }`.
- **MCP:** each tool handler catches and returns `{ content:[{type:'text', text:'Error: …'}],
  isError:true }` — never lets a raw throw escape.

## 12. CLI surface (`arxiv`, commander 15)

| Command | Purpose | Key flags |
|---|---|---|
| `arxiv search <query>` | search & discovery | `--author --category --title --abstract --sort relevance\|submitted\|updated --order asc\|desc --max --start --json` |
| `arxiv get <id...>` | metadata (1+ IDs) | `--bibtex --json` |
| `arxiv read <id>` | read full text | `--source auto\|html\|pdf --format markdown\|text --section <name> --max-chars <n> --out <file>` |
| `arxiv download <id...>` | save file(s) | `--out <dir>` (default downloads dir) |
| `arxiv recent <category>` | latest in a category | `--max --json` |
| `arxiv cache <clear\|path>` | cache maintenance (CLI-only by design — see §13) | — |

- Global: `--json`, `--no-cache`, `--cache-dir`, `--browser`, `--quiet/--verbose`.
- `arxiv download <id...>` loops `client.download(id)` per ID, printing each absolute path;
  **continue-on-error** (a failed ID is reported to stderr and processing continues); the process
  exits non-zero if any ID failed (exit code = the first failure's code from §11).
- Human-readable output by default; `--json` everywhere for scripting.

## 13. MCP surface (`arxiv-mcp`, SDK v1.x, stdio)

Authored with `new McpServer({name,version})` + `server.registerTool(name, config, cb)`. Input
schemas are zod raw shapes (`{ field: z.… }`). Data tools declare `outputSchema` and return
`structuredContent` alongside a text rendering.

| Tool | Input (zod shape) | Output |
|---|---|---|
| `arxiv_search` | `query?`,`author?`,`category?`,`title?`,`abstract?`,`sortBy?`,`sortOrder?`,`maxResults?`,`start?` | `structuredContent`: `{total,start,count,papers[],hints[]}` + text summary |
| `arxiv_get_metadata` | `ids: string[]`, `bibtex?: boolean` | per-ID metadata (+ optional BibTeX) |
| `arxiv_read_paper` | `id`,`source?`,`format?`,`section?`,`maxChars?`,`cursor?` | section-aware Markdown/text + `nextCursor` for chunked reads |
| `arxiv_list_recent` | `category`,`maxResults?` | recent papers in a category |
| `arxiv_download` | `id`,`dest?` | the absolute path as text **and** a `resource_link` content block (uri = `file://<path>`) |

- Imports use **`.js` suffixes**: `@modelcontextprotocol/sdk/server/mcp.js`,
  `@modelcontextprotocol/sdk/server/stdio.js`. `import { z } from 'zod'`.
- `arxiv_download` returns the path + a `resource_link` (single mechanism); a `registerResource`
  handler is **optional** and only added if a concrete client needs `ReadResource` bytes.
- **Cache maintenance is intentionally CLI/ops-only** — there is no MCP cache tool (an MCP client
  clearing a local FS cache is not a meaningful operation).
- `arxiv_read_paper` chunking (`maxChars`/`cursor`) lets Claude read a paper section-by-section
  rather than receiving an entire PDF's text at once.

## 14. Technology stack (pinned, verified 2026-06-19)

| Concern | Choice | Version | Why |
|---|---|---|---|
| Runtime | Node | ≥ 20.19 | dist needs only global `fetch`/Web Streams. **Build/dev needs ≥ 22.18** (tsdown — see §16). |
| Language | TypeScript | ^6.0 | `module`/`moduleResolution: NodeNext` (enforces `.js` import suffixes for a published ESM lib) |
| MCP | `@modelcontextprotocol/sdk` | ^1.29.0 (**v1.x**) | production line; v2/main is pre-alpha. `McpServer`+`registerTool` |
| Schemas | `zod` | ^3.25 \|\| ^4 | SDK peer/dep; `import { z } from 'zod'` |
| XML/Atom | `fast-xml-parser` | ^5.9.3 | `isArray: (t)=>['entry','author','category','link'].includes(t)` (predicate, **not** blanket); `removeNSPrefix`, `ignoreAttributes:false` |
| HTML DOM | `linkedom` | ^0.18.12 | lightweight Node DOM, no browser |
| HTML→MD | `turndown` + `turndown-plugin-gfm` | ^7.2.4 / ^1.0.2 | accepts linkedom nodes; GFM tables. gfm is **CJS** → `import gfmPkg from 'turndown-plugin-gfm'; const { gfm } = gfmPkg;`. Custom math/footnote rules. |
| PDF text | `unpdf` | ^1.6.2 | bundles PDF.js, worker inlined + polyfilled, zero config |
| Paths | `env-paths` | ^4.0.0 | cross-platform; returns strings (we `mkdir`) |
| CLI | `commander` | ^15.0.0 | ESM, small, first-class subcommands |
| Build | `tsdown` | ^0.22.3 | tsup's maintained successor; ESM, dts, multi-entry; native bin **shebang** handling. **engines `^22.18 \|\| >=24.11`** |
| Test | `vitest` | ^4.1.9 | fake timers for the rate limiter; fixture-based parser tests |
| Browser fallback | `playwright-core` | latest | **optionalDependency**, lazy-loaded; engaged only when `ApiDataSource` fails (§7.2); off by default. Uses an already-installed Chromium/Chrome if present. |

*Not in v1 (future/optional):* `pdfjs-dist` (only if coordinate-level PDF extraction is ever
needed — `unpdf` covers v1 text).

## 15. Testing strategy (TDD — tests first, per superpowers)

- **Unit (deterministic, no network):**
  - `parse/atom` — real Atom fixtures, **single-entry and multi-entry** (locks `isArray` shape),
    namespaced fields.
  - `parse/html-native`, `parse/html-ar5iv`, `parse/html-common` — fixtures of each schema; assert
    sections, abstract, **math/footnote preservation**, GFM tables; **a smoke test importing and
    `use()`-ing `turndown-plugin-gfm` under ESM** (catches CJS-interop regressions).
  - `parse/pdf` — small real arXiv PDF fixture; text + cleanup; single-section behavior.
  - `ids` — normalization table (new/old/versioned/URL forms; slash preserved in URL, `_` in
    filename).
  - `cache` — TTL by mutability; key includes `source`; cross-source miss.
  - `rate-limit` — `vi.useFakeTimers()` + `advanceTimersByTimeAsync`; add `process.nextTick`/
    `queueMicrotask` to `toFake` if the limiter awaits microtasks; per-host bucketing.
  - **`getContent` cursor round-trip** — chunk a multi-section fixture, walk `nextCursor` to
    completion, assert whole-section chunks, `id`-mismatch → `ParseError`, `truncated`/`nextCursor`
    invariants.
  - `bibtex` — generated `@misc` matches the template + key rules.
- **Adapters:** CLI parsing → mocked client (incl. exit codes, multi-ID download loop); MCP handlers
  → output shape (text + `structuredContent`/`resource_link`) with a mocked client.
- **Integration (opt-in, `ARXIV_LIVE=1`):** real API/HTML/PDF/bibtex for a known stable ID.
  **Skipped in CI.**
- Fixtures in `test/fixtures/`, loaded via `node:fs`.

## 16. Packaging & distribution

- `package.json`: `"type":"module"`, `"engines":{"node":">=20.19"}` (runtime), `"files":["dist"]`,
  `"exports": { ".": { "types":"./dist/index.d.ts", "import":"./dist/index.js" } }`,
  `"bin": { "arxiv":"./dist/cli.js", "arxiv-mcp":"./dist/mcp.js" }`. **Building requires Node
  ≥ 22.18** (tsdown 0.22.3 `engines`); document this for contributors/CI (e.g. a `devEngines`
  note), separate from the runtime floor.
- **tsdown** builds three entries (`index`, `cli`, `mcp`) to ESM + `.d.ts`; use tsdown's **native
  bin/shebang** support so `#!/usr/bin/env node` lands only on the bin chunks (avoid a manual
  `banner` that could leak onto the library chunk).
- **npx gotcha** (bin names ≠ package name → use `--package`):
  - `npx -y --package arxiv-toolkit arxiv search "…"`
  - `npx -y --package arxiv-toolkit arxiv-mcp`
  After `npm i -g arxiv-toolkit`, both bins are on `PATH`.
- **MCP registration (Claude Code):**
  `claude mcp add arxiv --scope user -- npx -y --package arxiv-toolkit arxiv-mcp`
  (options **before** the name; `--` **before** the command). The registered server name `arxiv`
  and the bin `arxiv-mcp` are intentionally distinct (logical name vs. launcher). README also
  documents the equivalent `.mcp.json` / `claude_desktop_config.json` `mcpServers` entry.
- License: MIT.

## 17. Implementation phases (for the plan)

Each phase lists its **shippable artifact**; a thin CLI arrives early so the tool is runnable
before the full surface lands.

1. **Scaffold** — package.json, tsconfig (NodeNext), tsdown, vitest, dirs, `types.ts`, `errors.ts`.
2. **IDs + config + paths** — `ids.ts`, `config.ts` (env-paths, precedence, `ArxivConfig`) + tests.
3. **HTTP + rate-limit + cache** — `http.ts`, `rate-limit.ts`, `cache.ts` + tests (fake timers).
4. **Search core** — `parse/atom.ts`, `ApiDataSource.search`, `ArxivClient.search/getPaper(s)/recent`
   + tests. *(First end-to-end core slice.)*
5. **Minimal CLI (`arxiv search`)** — commander bootstrap + the search command. **▶ First runnable,
   shippable artifact.**
6. **Read** — `parse/html-native`, `html-ar5iv`, `html-common`, `pdf`, `getContent` + chunking +
   **cursor round-trip tests**.
7. **Metadata + BibTeX** — `getPaper(s)` polish + `bibtex.ts` (fetch + generate) + tests.
8. **Expand CLI** — `get`, `read`, `recent`, `download` (multi-ID loop), `cache` + tests. **▶ Full
   CLI shippable increment.**
9. **MCP adapter** — tools, zod schemas, `structuredContent`, `resource_link` + tests. **▶ MCP
   shippable increment.**
10. **Browser fallback** — `BrowserDataSource` (lazy `playwright-core`) behind the existing
    `DataSource` seam, reusing the parsers; wire `browserFallback`/`--browser`/`ARXIV_BROWSER` and
    graceful degradation when no browser binary is present + tests.
11. **Packaging & docs** — bins, README (install, usage, MCP registration, browser-fallback note),
    integration pass.

## 18. Risks & mitigations

- **Native HTML gaps** (~10% PDF-only; ~25% imperfect LaTeXML) → three-tier fallback + `warnings` +
  cleanup.
- **Two HTML schemas** → separate parser branches → shared `html-common` converter.
- **Math fidelity in Markdown** → custom turndown rules preserving LaTeX verbatim; best-effort.
- **`turndown-plugin-gfm` is CJS & unmaintained since 2022** → pin, default-import shape, ESM smoke test.
- **arXiv 5xx / undocumented limits** → 3 s per-host limiter + backoff + caching.
- **MCP SDK v2 churn** (stable ~Q3 2026) → pin v1.x; plan a later migration.
- **Build/runtime Node split** (tsdown ≥ 22.18 vs runtime ≥ 20.19) → documented in §14/§16; CI uses ≥ 22.18.
- **Browser binary availability** (`playwright-core` needs an installed browser) → off by default;
  on first use without a browser, raise `UnsupportedError` with install guidance and leave the API
  path unaffected.
- **Large papers blowing LLM context** → mandatory section-granular chunking via `section`/`maxChars`/`cursor`.

## 19. Resolved decisions

- **Browser fallback is in v1** (user decision, 2026-06-19). The review flagged it as YAGNI, but it
  is included: `BrowserDataSource` ships behind the `DataSource` seam, **off by default**, engaged
  only when `ApiDataSource` fails for a non-content reason (§7.2). `playwright-core` is an
  `optionalDependency`, lazy-loaded, with graceful degradation when no browser is installed.

## 20. References

- arXiv API user manual — <https://info.arxiv.org/help/api/user-manual.html>
- arXiv bulk data — <https://info.arxiv.org/help/bulk_data.html>, <https://info.arxiv.org/help/bulk_data_s3.html>
- arXiv BibTeX/Eprints — <https://info.arxiv.org/help/hypertex/bibstyles/index.html>; live `https://arxiv.org/bibtex/{id}`
- MCP TypeScript SDK (v1.x) — <https://github.com/modelcontextprotocol/typescript-sdk/tree/v1.x>, <https://ts.sdk.modelcontextprotocol.io/>
- Claude Code MCP — <https://code.claude.com/docs/en/mcp>
- Library versions (npm `latest`, 2026-06-19): `@modelcontextprotocol/sdk` 1.29.0, `fast-xml-parser` 5.9.3,
  `linkedom` 0.18.12, `turndown` 7.2.4, `turndown-plugin-gfm` 1.0.2, `unpdf` 1.6.2, `env-paths` 4.0.0,
  `commander` 15.0.0, `tsdown` 0.22.3 (engines `^22.18 || >=24.11`), `vitest` 4.1.9, `typescript` 6.0.3.
- Live endpoint verification (2026-06-19): `export.arxiv.org/api/query`, `arxiv.org/{abs,html,pdf,bibtex}/…`,
  `ar5iv.labs.arxiv.org/html/…` — behaviors above confirmed via `curl`/`npm view`/install-and-run.
```
