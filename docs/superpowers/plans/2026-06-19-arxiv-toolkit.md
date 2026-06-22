# arXiv Toolkit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `arxiv-toolkit` — a TypeScript library exposed as a CLI (`arxiv`) and an MCP server (`arxiv-mcp`) that searches arXiv, fetches metadata, and reads papers (HTML→Markdown with PDF fallback).

**Architecture:** A single ESM npm package with a framework-free `core` library (arXiv client, parsers, cache, rate limiter, config) and two thin adapters (Commander CLI, MCP stdio server) over `ArxivClient`. Data is fetched API-first via official arXiv endpoints behind a `DataSource` interface, with a lazy `playwright-core` browser fallback (off by default).

**Tech Stack:** TypeScript 6 (NodeNext ESM), `@modelcontextprotocol/sdk` v1.x, `commander`, `fast-xml-parser`, `linkedom` + `turndown` + `turndown-plugin-gfm`, `unpdf`, `env-paths`, `playwright-core` (optional), `tsdown` (build), `vitest` (test).

Full design: `docs/superpowers/specs/2026-06-19-arxiv-toolkit-design.md`.

## Global Constraints

- **Package:** name `arxiv-toolkit`; `"type": "module"` (pure ESM); two bins — `arxiv` → `dist/cli.js`, `arxiv-mcp` → `dist/mcp.js`; library `exports` `.` → `dist/index.js` (+ `dist/index.d.ts`).
- **Node:** runtime floor `>=20.19`; **building/dev requires `>=22.18`** (tsdown 0.22.3 engines `^22.18 || >=24.11`).
- **TypeScript:** `module`/`moduleResolution`: `NodeNext`, `target`: `ES2022`, `strict: true`, `declaration: true`. **All relative imports carry the `.js` suffix** (e.g. `import { normalizeId } from "./ids.js"`).
- **MCP SDK:** pin `@modelcontextprotocol/sdk@^1.29.0` (v1.x — NOT v2/main). Use `McpServer` + `registerTool`; import paths keep `.js` (`@modelcontextprotocol/sdk/server/mcp.js`, `.../server/stdio.js`). `import { z } from "zod"` (`zod ^3.25 || ^4`).
- **Pinned deps:** `@modelcontextprotocol/sdk ^1.29.0`, `zod ^3.25`, `fast-xml-parser ^5.9.3`, `linkedom ^0.18.12`, `turndown ^7.2.4`, `turndown-plugin-gfm ^1.0.2`, `unpdf ^1.6.2`, `env-paths ^4.0.0`, `commander ^15.0.0`; optional `playwright-core` (latest). Dev: `typescript ^6.0`, `tsdown ^0.22.3`, `vitest ^4.1.9`, `@types/node`, `@types/turndown`.
- **`turndown-plugin-gfm` is CJS:** import as `import gfmPkg from "turndown-plugin-gfm"; const { gfm } = gfmPkg;`.
- **arXiv etiquette (mandatory):** descriptive User-Agent with contact; per-host min-interval limiter default 3000 ms; retry with backoff on 429/5xx; `max_results` clamped to ≤ 2000.
- **Base URLs:** API `https://export.arxiv.org/api/query`; content `https://arxiv.org/{abs,html,pdf,bibtex}/{id}`; ar5iv `https://ar5iv.labs.arxiv.org/html/{id}`.
- **Testing:** `vitest`; tests live in `test/` mirroring `src/` paths, named `*.test.ts`; `import { describe, it, expect, vi, beforeEach } from "vitest"`. Network is never hit in unit tests (mock `fetch`/`DataSource`); live tests are gated behind `ARXIV_LIVE=1` and excluded from CI.
- **Commits:** conventional-commit messages; one commit per task at the final step.

## File Structure

| Path | Responsibility |
|---|---|
| `package.json`, `tsconfig.json`, `tsdown.config.ts`, `vitest.config.ts` | Package manifest, TS config (NodeNext/ES2022), build (3 entries + bin shebang), test config. |
| `src/index.ts` | Public library entry; re-exports `core` public surface. |
| `src/core/types.ts` | Shared types: `Paper`, `Author`, `SearchParams`, `SearchResult`, `Section`, `PaperContent`, `ReadOptions`, `DownloadOptions`, `ArxivConfig`, `NormalizedId`. |
| `src/core/errors.ts` | `ArxivError` base + `NotFoundError`/`RateLimitedError`/`NetworkError`/`ParseError`/`UnsupportedError` with `code` + exit-code mapping. |
| `src/core/ids.ts` | Normalize/parse arXiv ids (new/old/versioned/URL forms); URL builders; on-disk filename sanitizer. |
| `src/core/config.ts` | `resolveConfig()` → `ArxivConfig` via `env-paths` + precedence (flag→env→file→default); User-Agent assembly. |
| `src/core/rate-limit.ts` | Per-host min-interval limiter. |
| `src/core/cache.ts` | Filesystem cache (key hash + sidecar TTL). |
| `src/core/http.ts` | `fetch` wrapper: UA header, timeout, retry/backoff, routed through the limiter and cache. |
| `src/core/datasource/datasource.ts` | `DataSource` interface (transport seam). |
| `src/core/datasource/api.ts` | `ApiDataSource` — official endpoints via `http.ts`. |
| `src/core/datasource/browser.ts` | `BrowserDataSource` — lazy `playwright-core` fallback. |
| `src/core/parse/atom.ts` | Atom XML → `Paper[]` + paging via `fast-xml-parser`. |
| `src/core/parse/html-native.ts` | arxiv.org/html (`ltx_*`) → `Section[]`. |
| `src/core/parse/html-ar5iv.ts` | ar5iv (legacy schema) → `Section[]`. |
| `src/core/parse/html-common.ts` | Shared section→Markdown (`turndown` + gfm + math/footnote rules). |
| `src/core/parse/pdf.ts` | `unpdf` text extraction + cleanup → single best-effort `Section`. |
| `src/core/bibtex.ts` | Fetch canonical `bibtex/{id}` + `@misc` generator fallback. |
| `src/core/client.ts` | `ArxivClient` orchestrator (ids→cache→limiter→datasource→parse; source matrix; chunking/cursor). |
| `src/cli/index.ts` | `#!/usr/bin/env node` Commander program + global flags + exit-code mapping. |
| `src/cli/commands/*.ts` | `search`, `get`, `read`, `download`, `recent`, `cache` command handlers. |
| `src/mcp/index.ts` | `#!/usr/bin/env node` boots the stdio server. |
| `src/mcp/server.ts` | `McpServer` + `registerTool` for the 5 tools. |
| `test/**` | `vitest` unit/adapter tests mirroring `src/`; `test/fixtures/` real Atom/HTML/PDF samples; `test/live/` gated integration. |

---


## Phase 1: Scaffold

<!-- Phase: Scaffold -->

### Task A: Package manifest & toolchain config

**Files:**
- Source: `/Users/aildan/arxiv/package.json` (Create)
- Source: `/Users/aildan/arxiv/tsconfig.json` (Create)
- Source: `/Users/aildan/arxiv/tsdown.config.ts` (Create)
- Source: `/Users/aildan/arxiv/vitest.config.ts` (Create)
- Commit: `package.json`, `tsconfig.json`, `tsdown.config.ts`, `vitest.config.ts`

**Interfaces:**
- Consumes: nothing (root of the dependency graph)
- Produces: an installable npm package manifest; a NodeNext/ES2022 TypeScript config; a tsdown build config for the `index` entry only (cli/mcp entries are added in Phase 11); a vitest config

- [ ] **Step 1: Create package.json.** Create `/Users/aildan/arxiv/package.json`. Complete contents:

```json
{
  "name": "arxiv-toolkit",
  "version": "0.1.0",
  "description": "CLI and MCP server for searching arXiv, fetching metadata, and reading papers",
  "type": "module",
  "license": "MIT",
  "author": {
    "name": "Ali Ildan",
    "email": "ali.ildan@gmail.com"
  },
  "repository": {
    "type": "git",
    "url": "https://github.com/aliildan/arxiv-toolkit"
  },
  "engines": {
    "node": ">=20.19"
  },
  "files": ["dist"],
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "bin": {
    "arxiv": "./dist/cli.js",
    "arxiv-mcp": "./dist/mcp.js"
  },
  "scripts": {
    "build": "tsdown",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.29.0",
    "commander": "^15.0.0",
    "env-paths": "^4.0.0",
    "fast-xml-parser": "^5.9.3",
    "linkedom": "^0.18.12",
    "turndown": "^7.2.4",
    "turndown-plugin-gfm": "^1.0.2",
    "unpdf": "^1.6.2",
    "zod": "^3.25"
  },
  "optionalDependencies": {
    "playwright-core": "*"
  },
  "devDependencies": {
    "@types/node": "*",
    "@types/turndown": "*",
    "tsdown": "^0.22.3",
    "typescript": "^6.0",
    "vitest": "^4.1.9"
  }
}
```

Note: `"engines"` is the runtime floor (`>=20.19`). Building requires Node `>=22.18` because tsdown 0.22.3's own `engines` field is `^22.18 || >=24.11`. Document this for contributors and CI by pinning Node `>=22.18` in your CI workflow (not in `engines` here, which must remain the published runtime floor). A `devEngines` comment is not a standard `package.json` field and is omitted; use a `.nvmrc` or CI matrix to communicate the build requirement.

- [ ] **Step 2: Create tsconfig.json.** Create `/Users/aildan/arxiv/tsconfig.json`. Complete contents:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": "src",
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: Create tsdown.config.ts.** Create `/Users/aildan/arxiv/tsdown.config.ts`. Complete contents:

```ts
import { defineConfig } from "tsdown";

// Phase 1: only the library entry exists.
// Phase 11 (Packaging) adds the cli and mcp entries together with their
// #!/usr/bin/env node bin shebangs via tsdown's native shebang support —
// at that point this file gains two more entries:
//   { entry: "src/cli/index.ts", platform: "node", banner: { js: "#!/usr/bin/env node" } }
//   { entry: "src/mcp/index.ts", platform: "node", banner: { js: "#!/usr/bin/env node" } }
// Do NOT add those entries now; cli/mcp source files don't exist yet and
// tsdown would fail the build.

export default defineConfig({
  entry: {
    index: "src/index.ts",
  },
  format: ["esm"],
  dts: true,
  platform: "node",
  clean: true,
});
```

- [ ] **Step 4: Create vitest.config.ts.** Create `/Users/aildan/arxiv/vitest.config.ts`. Complete contents:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["test/live/**"],
    environment: "node",
  },
});
```

- [ ] **Step 5: Install dependencies.** Run:

```
cd /Users/aildan/arxiv && npm install
```

Expected: exit 0; `node_modules/` and `package-lock.json` created. The `playwright-core` optional dependency may be skipped or warn if no supported browser binary is present — that is expected and not an error.

- [ ] **Step 6: Run typecheck on the (still empty) source tree.** Run:

```
cd /Users/aildan/arxiv && npm run typecheck
```

Expected: either PASS (no `.ts` files to check yet) or a clean "no input files" diagnostic — not a compilation error. If `tsc` complains that `rootDir` `src` has no files, create a placeholder `src/.gitkeep` (or proceed to Task B which creates `src/core/types.ts` immediately — see note below).

Note: Task A and Task B are sequenced so that the typecheck gate is re-run at the end of Task B over actual source files. If `tsc --noEmit` errors here because `src/` is empty, that is acceptable; the authoritative typecheck gate for Phase 1 is the one at the end of Task B (Step 7 below).

- [ ] **Step 7: Commit.** Run:

```
git add package.json tsconfig.json tsdown.config.ts vitest.config.ts package-lock.json && git commit -m "chore(scaffold): add package manifest and toolchain config

- package.json: arxiv-toolkit, ESM, Node >=20.19 runtime floor, two bins
  (arxiv/arxiv-mcp → dist/cli.js/mcp.js), exports map, all pinned deps.
- tsconfig.json: NodeNext/ES2022/strict; all relative imports must carry .js.
- tsdown.config.ts: index entry only (cli/mcp added in Phase 11).
- vitest.config.ts: test/**/*.test.ts, live tests excluded.
"
```

---

### Task B: Core types & errors

**Files:**
- Source: `/Users/aildan/arxiv/src/core/types.ts` (Create)
- Source: `/Users/aildan/arxiv/src/core/errors.ts` (Create)
- Source: `/Users/aildan/arxiv/src/index.ts` (Create)
- Test: `/Users/aildan/arxiv/test/core/errors.test.ts` (Create)
- Commit: `src/core/types.ts`, `src/core/errors.ts`, `src/index.ts`, `test/core/errors.test.ts`

**Interfaces:**
- Consumes: nothing (these are the base types; no other src files exist yet)
- Produces:
  - All exported types and interfaces from `src/core/types.ts` (frozen — see §1 of _shared-contracts.md)
  - `ArxivError`, `NotFoundError`, `RateLimitedError`, `NetworkError`, `ParseError`, `UnsupportedError`, `exitCodeFor` from `src/core/errors.ts` (frozen — see §2 of _shared-contracts.md)
  - `src/index.ts` re-exporting `./core/types.js` and `./core/errors.js` for Phase 1 (ArxivClient and normalizeId re-exports are added in later phases)

- [ ] **Step 1: Write the failing test file first.** Create `/Users/aildan/arxiv/test/core/errors.test.ts`. Complete contents:

```ts
import { describe, it, expect } from "vitest";
import {
  ArxivError,
  NotFoundError,
  RateLimitedError,
  NetworkError,
  ParseError,
  UnsupportedError,
  exitCodeFor,
} from "../../src/core/errors.js";

describe("error class hierarchy", () => {
  it("NotFoundError is an instanceof ArxivError", () => {
    const err = new NotFoundError("paper not found");
    expect(err).toBeInstanceOf(ArxivError);
    expect(err).toBeInstanceOf(NotFoundError);
  });

  it("NotFoundError has code NOT_FOUND", () => {
    const err = new NotFoundError("x");
    expect(err.code).toBe("NOT_FOUND");
  });

  it("RateLimitedError is instanceof ArxivError with code RATE_LIMITED", () => {
    const err = new RateLimitedError("x");
    expect(err).toBeInstanceOf(ArxivError);
    expect(err.code).toBe("RATE_LIMITED");
  });

  it("NetworkError is instanceof ArxivError with code NETWORK", () => {
    const err = new NetworkError("x");
    expect(err).toBeInstanceOf(ArxivError);
    expect(err.code).toBe("NETWORK");
  });

  it("ParseError is instanceof ArxivError with code PARSE", () => {
    const err = new ParseError("x");
    expect(err).toBeInstanceOf(ArxivError);
    expect(err.code).toBe("PARSE");
  });

  it("UnsupportedError is instanceof ArxivError with code UNSUPPORTED", () => {
    const err = new UnsupportedError("x");
    expect(err).toBeInstanceOf(ArxivError);
    expect(err.code).toBe("UNSUPPORTED");
  });

  it("ArxivError defaults to code GENERIC", () => {
    const err = new ArxivError("x");
    expect(err.code).toBe("GENERIC");
    expect(err).toBeInstanceOf(Error);
  });

  it("error name matches the class name (via new.target)", () => {
    expect(new NotFoundError("x").name).toBe("NotFoundError");
    expect(new RateLimitedError("x").name).toBe("RateLimitedError");
    expect(new NetworkError("x").name).toBe("NetworkError");
    expect(new ParseError("x").name).toBe("ParseError");
    expect(new UnsupportedError("x").name).toBe("UnsupportedError");
    expect(new ArxivError("x").name).toBe("ArxivError");
  });
});

describe("exitCodeFor", () => {
  it("NotFoundError → 2", () => {
    expect(exitCodeFor(new NotFoundError("x"))).toBe(2);
  });

  it("RateLimitedError → 3", () => {
    expect(exitCodeFor(new RateLimitedError("x"))).toBe(3);
  });

  it("NetworkError → 4", () => {
    expect(exitCodeFor(new NetworkError("x"))).toBe(4);
  });

  it("ParseError → 5", () => {
    expect(exitCodeFor(new ParseError("x"))).toBe(5);
  });

  it("UnsupportedError → 6", () => {
    expect(exitCodeFor(new UnsupportedError("x"))).toBe(6);
  });

  it("plain ArxivError (GENERIC code) → 1", () => {
    expect(exitCodeFor(new ArxivError("x"))).toBe(1);
  });

  it("non-ArxivError (plain Error) → 1", () => {
    expect(exitCodeFor(new Error("boom"))).toBe(1);
  });

  it("non-Error values → 1", () => {
    expect(exitCodeFor("a string")).toBe(1);
    expect(exitCodeFor(42)).toBe(1);
    expect(exitCodeFor(null)).toBe(1);
    expect(exitCodeFor(undefined)).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test, expect FAIL.** Run:

```
cd /Users/aildan/arxiv && npx vitest run test/core/errors.test.ts
```

Expected: FAIL — `Cannot find module '../../src/core/errors.js'` (the source file does not exist yet). Confirm the failure is only a missing-module error, not a config/syntax problem.

- [ ] **Step 3: Create src/core/types.ts.** Create `/Users/aildan/arxiv/src/core/types.ts`. Transcribe verbatim from _shared-contracts.md §1. Complete contents:

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

- [ ] **Step 4: Create src/core/errors.ts.** Create `/Users/aildan/arxiv/src/core/errors.ts`. Transcribe verbatim from _shared-contracts.md §2. Complete contents:

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

- [ ] **Step 5: Create src/index.ts.** Create `/Users/aildan/arxiv/src/index.ts`. Complete contents:

```ts
// Public library entry point.
// Phase 1 exports: types and errors only.
// Later phases add:
//   export { ArxivClient } from "./core/client.js";   // Phase 4
//   export { normalizeId } from "./core/ids.js";       // Phase 2

export * from "./core/types.js";
export * from "./core/errors.js";
```

- [ ] **Step 6: Run the test, expect PASS.** Run:

```
cd /Users/aildan/arxiv && npx vitest run test/core/errors.test.ts
```

Expected: PASS — all error-class hierarchy assertions and all `exitCodeFor` exit-code mappings green.

- [ ] **Step 7: Run typecheck.** Run:

```
cd /Users/aildan/arxiv && npm run typecheck
```

Expected: PASS — `src/core/types.ts`, `src/core/errors.ts`, and `src/index.ts` compile cleanly with no type errors. `types.ts` has no runtime behavior; its correctness is fully verified by `tsc --noEmit` passing. Do NOT invent a runtime test for pure interfaces.

- [ ] **Step 8: Commit.** Run:

```
git add src/core/types.ts src/core/errors.ts src/index.ts test/core/errors.test.ts && git commit -m "feat(core): add frozen types, errors, and public index entry

- src/core/types.ts: Paper, Author, SearchParams, SearchResult, Section,
  PaperContent, ReadOptions, DownloadOptions, ArxivConfig, NormalizedId
  (verbatim from shared contracts).
- src/core/errors.ts: ArxivError base + five subclasses with stable codes;
  exitCodeFor maps each to the spec §11 CLI exit code (0-ok is caller's
  concern; 1-generic, 2-NotFound, 3-RateLimited, 4-Network, 5-Parse, 6-Unsupported).
- src/index.ts: re-exports types and errors; ArxivClient/normalizeId stubs
  noted for Phases 4 and 2.
- test/core/errors.test.ts: asserts instanceof chains, code strings, name
  via new.target, exitCodeFor for every subclass plus plain ArxivError and
  non-ArxivError inputs.
"
```

---

## Phase 2: IDs + config + paths

<!-- Phase: IDs + config + paths -->

### Task: ID normalization and URL builders (src/core/ids.ts)

**Files:**
- Test: `/Users/aildan/arxiv/test/core/ids.test.ts` (Create)
- Source: `/Users/aildan/arxiv/src/core/ids.ts` (Create)
- Commit: `src/core/ids.ts`, `test/core/ids.test.ts`

**Interfaces:**
- Consumes: `NormalizedId` from `src/core/types.ts` (`{ id: string; version?: number; idWithVersion?: string }`); `ParseError` from `src/core/errors.ts` (`new ParseError(message)`).
- Produces:
  - `export function normalizeId(input: string): NormalizedId`
  - `export function absUrl(n: NormalizedId): string`
  - `export function htmlUrl(n: NormalizedId): string`
  - `export function ar5ivUrl(n: NormalizedId): string`
  - `export function pdfUrl(n: NormalizedId): string`
  - `export function bibtexUrl(n: NormalizedId): string`
  - `export function filenameFor(n: NormalizedId): string`

**Notes for the implementer:** `env-paths` is CJS; import it as `import envPaths from "env-paths"` (default export is callable). This task does not import env-paths — that is only for the config task. The id regexes (from the contract):
- New style: `^\d{4}\.\d{4,5}$`
- Old style: `^[a-z\-]+(\.[A-Z]{2})?/\d{7}$`
- Optional version suffix `(v\d+)?` applies to both.
Accept `/abs/`, `/html/`, `/pdf/` path prefixes and ar5iv host URLs and strip the prefix. Keep the literal slash in old-style IDs in URLs (do NOT `%2F`-encode). Replace `/` with `_` only in `filenameFor`. `filenameFor` appends `v{n}` after the id when `version` is present, plus the `.pdf` extension (e.g. `cond-mat_0011267v1.pdf`).

- [ ] **Step 1: Write the failing table-driven test file.** Create `test/core/ids.test.ts` with the full normalization table plus URL/filename assertions. Complete file:

```ts
import { describe, it, expect } from "vitest";
import {
  normalizeId,
  absUrl,
  htmlUrl,
  ar5ivUrl,
  pdfUrl,
  bibtexUrl,
  filenameFor,
} from "../../src/core/ids.js";

describe("normalizeId", () => {
  it("parses new-style ids without version", () => {
    expect(normalizeId("2310.06825")).toEqual({
      id: "2310.06825",
      version: undefined,
      idWithVersion: undefined,
    });
  });

  it("parses new-style ids with version", () => {
    expect(normalizeId("2310.06825v3")).toEqual({
      id: "2310.06825",
      version: 3,
      idWithVersion: "2310.06825v3",
    });
  });

  it("parses old-style ids without version (keeps slash)", () => {
    expect(normalizeId("cond-mat/0011267")).toEqual({
      id: "cond-mat/0011267",
      version: undefined,
      idWithVersion: undefined,
    });
  });

  it("parses old-style ids with subject class and version", () => {
    expect(normalizeId("math.GT/0309136v2")).toEqual({
      id: "math.GT/0309136",
      version: 2,
      idWithVersion: "math.GT/0309136v2",
    });
  });

  it("strips /abs/ prefix", () => {
    expect(normalizeId("https://arxiv.org/abs/2310.06825v1")).toEqual({
      id: "2310.06825",
      version: 1,
      idWithVersion: "2310.06825v1",
    });
  });

  it("strips /html/ prefix", () => {
    expect(normalizeId("https://arxiv.org/html/cond-mat/0011267")).toEqual({
      id: "cond-mat/0011267",
      version: undefined,
      idWithVersion: undefined,
    });
  });

  it("strips /pdf/ prefix and optional .pdf suffix", () => {
    expect(normalizeId("https://arxiv.org/pdf/2310.06825v2.pdf")).toEqual({
      id: "2310.06825",
      version: 2,
      idWithVersion: "2310.06825v2",
    });
  });

  it("strips ar5iv host and path", () => {
    expect(normalizeId("https://ar5iv.labs.arxiv.org/html/2310.06825")).toEqual({
      id: "2310.06825",
      version: undefined,
      idWithVersion: undefined,
    });
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeId("  2310.06825v1  ")).toEqual({
      id: "2310.06825",
      version: 1,
      idWithVersion: "2310.06825v1",
    });
  });

  it("is case-insensitive for the arxiv host but keeps subject class case in id", () => {
    expect(normalizeId("HTTPS://ARXIV.ORG/ABS/math.GT/0309136")).toEqual({
      id: "math.GT/0309136",
      version: undefined,
      idWithVersion: undefined,
    });
  });

  it.each([
    "",
    "   ",
    "not-an-id",
    "2310.06", // too few digits after dot
    "2310.068256", // too many digits after dot
    "12345.06825", // too many digits before dot
    "cond-mat/001126", // too few digits old style
    "COND-MAT/0011267", // old-style subject class must be lowercase
    "math.gt/0309136", // subject class suffix must be uppercase
    "v1",
    "https://arxiv.org/abs/",
    "https://example.com/2310.06825",
  ])("throws on invalid input %p", (input) => {
    expect(() => normalizeId(input)).toThrow();
  });
});

describe("url builders keep slash in old-style ids", () => {
  it("absUrl for new-style unversioned", () => {
    expect(absUrl(normalizeId("2310.06825"))).toBe(
      "https://arxiv.org/abs/2310.06825",
    );
  });
  it("absUrl for new-style versioned", () => {
    expect(absUrl(normalizeId("2310.06825v3"))).toBe(
      "https://arxiv.org/abs/2310.06825v3",
    );
  });
  it("absUrl for old-style keeps slash (not %2F)", () => {
    expect(absUrl(normalizeId("cond-mat/0011267"))).toBe(
      "https://arxiv.org/abs/cond-mat/0011267",
    );
  });
  it("htmlUrl for old-style versioned keeps slash", () => {
    expect(htmlUrl(normalizeId("cond-mat/0011267v1"))).toBe(
      "https://arxiv.org/html/cond-mat/0011267v1",
    );
  });
  it("ar5ivUrl keeps slash", () => {
    expect(ar5ivUrl(normalizeId("cond-mat/0011267"))).toBe(
      "https://ar5iv.labs.arxiv.org/html/cond-mat/0011267",
    );
  });
  it("pdfUrl appends .pdf for unversioned", () => {
    expect(pdfUrl(normalizeId("2310.06825"))).toBe(
      "https://arxiv.org/pdf/2310.06825.pdf",
    );
  });
  it("pdfUrl for versioned new-style", () => {
    expect(pdfUrl(normalizeId("2310.06825v2"))).toBe(
      "https://arxiv.org/pdf/2310.06825v2.pdf",
    );
  });
  it("pdfUrl keeps slash for old-style", () => {
    expect(pdfUrl(normalizeId("cond-mat/0011267"))).toBe(
      "https://arxiv.org/pdf/cond-mat/0011267.pdf",
    );
  });
  it("bibtexUrl keeps slash", () => {
    expect(bibtexUrl(normalizeId("math.GT/0309136v2"))).toBe(
      "https://arxiv.org/bibtex/math.GT/0309136v2",
    );
  });
});

describe("filenameFor replaces slash with underscore", () => {
  it("new-style unversioned", () => {
    expect(filenameFor(normalizeId("2310.06825"))).toBe("2310.06825.pdf");
  });
  it("new-style versioned appends v{n}", () => {
    expect(filenameFor(normalizeId("2310.06825v3"))).toBe(
      "2310.06825v3.pdf",
    );
  });
  it("old-style unversioned: slash -> underscore", () => {
    expect(filenameFor(normalizeId("cond-mat/0011267"))).toBe(
      "cond-mat_0011267.pdf",
    );
  });
  it("old-style versioned with subject class: slash -> underscore", () => {
    expect(filenameFor(normalizeId("math.GT/0309136v2"))).toBe(
      "math.GT_0309136v2.pdf",
    );
  });
});
```

- [ ] **Step 2: Run the test, expect FAIL.** Run: `npx vitest run test/core/ids.test.ts`. Expected: FAIL — `Cannot find module '../../src/core/ids.js'` (module does not exist yet).

- [ ] **Step 3: Implement src/core/ids.ts.** Create the file. Complete contents:

```ts
import type { NormalizedId } from "./types.js";
import { ParseError } from "./errors.js";

const NEW_ID = /^\d{4}\.\d{4,5}$/;
const OLD_ID = /^[a-z-]+(\.[A-Z]{2})?\/\d{7}$/;
const VERSION = /^v(\d+)$/;

// Matches an optional leading URL/host/path-prefix that we strip before parsing
// the bare id. Captures the tail that should contain the id (+ optional version).
const PREFIX = /^(?:https?:\/\/)?(?:[^/]+\/)?(?:abs|html|pdf|bibtex)\//i;

interface Parsed {
  id: string;
  version?: number;
}

function parseBare(raw: string): Parsed {
  // Strip a trailing .pdf (only meaningful for /pdf/ URLs, harmless otherwise).
  let s = raw.replace(/\.pdf$/i, "");
  // Strip an optional version suffix to inspect the core id.
  let version: number | undefined;
  const vMatch = s.match(/^(.*)v(\d+)$/);
  let core: string;
  if (vMatch) {
    core = vMatch[1];
    version = Number(vMatch[2]);
  } else {
    core = s;
  }
  if (!NEW_ID.test(core) && !OLD_ID.test(core)) {
    throw new ParseError(`Invalid arXiv id: ${raw}`);
  }
  return { id: core, version };
}

/**
 * Normalize an arXiv identifier from any accepted input form (bare id,
 * abs/html/pdf/bibtex URL, or ar5iv URL) into a canonical NormalizedId.
 * The old-style slash is preserved verbatim in `id` and in all URLs.
 */
export function normalizeId(input: string): NormalizedId {
  if (typeof input !== "string") {
    throw new ParseError(`Invalid arXiv id: ${String(input)}`);
  }
  let s = input.trim();
  if (s.length === 0) {
    throw new ParseError("Invalid arXiv id: empty input");
  }
  // Lowercase the scheme/host so hostname matching is case-insensitive,
  // but DO NOT lowercase the id tail (old-style subject classes are case-significant).
  const schemeHostEnd = s.indexOf("://");
  if (schemeHostEnd !== -1) {
    const hostEnd = s.indexOf("/", schemeHostEnd + 3);
    if (hostEnd !== -1) {
      s = s.slice(0, schemeHostEnd + 3).toLowerCase() + s.slice(hostEnd);
    }
  }
  s = s.replace(PREFIX, "");
  const parsed = parseBare(s);
  const n: NormalizedId = { id: parsed.id };
  if (parsed.version !== undefined) {
    n.version = parsed.version;
    n.idWithVersion = `${parsed.id}v${parsed.version}`;
  }
  return n;
}

function withVersion(n: NormalizedId): string {
  return n.idWithVersion ?? n.id;
}

export function absUrl(n: NormalizedId): string {
  return `https://arxiv.org/abs/${withVersion(n)}`;
}

export function htmlUrl(n: NormalizedId): string {
  return `https://arxiv.org/html/${withVersion(n)}`;
}

export function ar5ivUrl(n: NormalizedId): string {
  return `https://ar5iv.labs.arxiv.org/html/${withVersion(n)}`;
}

export function pdfUrl(n: NormalizedId): string {
  return `https://arxiv.org/pdf/${withVersion(n)}.pdf`;
}

export function bibtexUrl(n: NormalizedId): string {
  return `https://arxiv.org/bibtex/${withVersion(n)}`;
}

/**
 * On-disk filename: the id slash (old-style) is replaced with `_`;
 * a known version is appended as `v{n}`; always ends in `.pdf`.
 */
export function filenameFor(n: NormalizedId): string {
  const base = withVersion(n).replace("/", "_");
  return `${base}.pdf`;
}
```

- [ ] **Step 4: Run the test, expect PASS.** Run: `npx vitest run test/core/ids.test.ts`. Expected: PASS — all `normalizeId`, URL-builder, and `filenameFor` cases green.

- [ ] **Step 5: Run typecheck.** Run: `npx tsc --noEmit`. Expected: PASS (no type errors). If `tsc` reports the project's other not-yet-existing files, that is out of this task's scope — confirm only `src/core/ids.ts` and `test/core/ids.test.ts` are clean (no errors originating in those files).

- [ ] **Step 6: Commit.** Run:
```
git add src/core/ids.ts test/core/ids.test.ts && git commit -m "feat(core): add arXiv id normalization and URL builders

- normalizeId accepts bare ids (new/old style), abs/html/pdf/bibtex URLs,
  and ar5iv URLs; strips path prefix; keeps old-style slash verbatim.
- abs/html/ar5iv/pdf/bibtex URL builders preserve the slash (no %2F).
- filenameFor replaces slash with underscore and appends v{n} + .pdf.
- Table-driven test covers new/old/subject-class/versioned/URL forms and
  invalid-input rejection.
"
```

### Task: Configuration resolution and User-Agent assembly (src/core/config.ts)

**Files:**
- Test: `/Users/aildan/arxiv/test/core/config.test.ts` (Create)
- Source: `/Users/aildan/arxiv/src/core/config.ts` (Create)
- Commit: `src/core/config.ts`, `test/core/config.test.ts`

**Interfaces:**
- Consumes: `ArxivConfig` from `src/core/types.ts`; `package.json` (`name`, `version`, `repository`, `author`) read via `createRequire`/`import.meta.url` or a static build-time import; `env-paths` (`import envPaths from "env-paths"`; `envPaths("arxiv-toolkit", { suffix: "" })` → `{ data, config, cache, log, temp }`).
- Produces:
  - `export function resolveConfig(overrides?: Partial<ArxivConfig>): ArxivConfig`

**Notes for the implementer:** Precedence is `overrides > env > configFile > default`. Read the config file from `<configDir>/config.json` (a `Partial<ArxivConfig>`; unknown keys ignored; a missing or malformed file is silently treated as `{}` — never throw). Defaults: `rateMs` 3000, `noCache` false, `defaultMaxResults` 25, `browserFallback` false, `downloadsDir` = `<data>/papers`. Env map: `ARXIV_CACHE_DIR`→`cacheDir`, `ARXIV_DOWNLOADS_DIR`→`downloadsDir`, `ARXIV_RATE_MS`→`rateMs` (parse int), `ARXIV_USER_AGENT`→`userAgent`, `ARXIV_CONTACT`→`contact`, `ARXIV_NO_CACHE`→`noCache` (truthy: `1`,`true`,`yes` case-insensitive), `ARXIV_MAX_RESULTS`→`defaultMaxResults` (parse int), `ARXIV_BROWSER`→`browserFallback` (truthy). UA assembly: `arxiv-toolkit/<version> (+<repoUrl>; mailto:<contact>)`; drop the `; mailto:<contact>` segment entirely when no contact is available (resolved from `ARXIV_CONTACT` env then `package.json` author email), giving `arxiv-toolkit/<version> (+<repoUrl>)`. `ARXIV_USER_AGENT` overrides the whole string. Because `resolveConfig` reads `package.json`, gate that read so it works under vitest (read the real `package.json` at the repo root via `createRequire(import.meta.url)` so the test asserts a UA containing the package name and version). To keep tests deterministic, the test stubs `process.env`, points `configDir` at a temp dir via the env-driven config path, and overrides the version/repo/contact through a minimal fixture `package.json` read — see the test for the exact seam: the test calls `resolveConfig()` with no contact env and asserts the UA drops the mailto segment, then sets `ARXIV_CONTACT` and asserts it appears.

- [ ] **Step 1: Write the failing test file.** Create `test/core/config.test.ts`. Complete file:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveConfig } from "../../src/core/config.js";

const ENV_KEYS = [
  "ARXIV_CACHE_DIR",
  "ARXIV_DOWNLOADS_DIR",
  "ARXIV_RATE_MS",
  "ARXIV_USER_AGENT",
  "ARXIV_CONTACT",
  "ARXIV_NO_CACHE",
  "ARXIV_MAX_RESULTS",
  "ARXIV_BROWSER",
];

let savedEnv: Record<string, string | undefined>;
let tempConfigDir: string;

beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  tempConfigDir = mkdtempSync(join(tmpdir(), "arxiv-cfg-"));
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  rmSync(tempConfigDir, { recursive: true, force: true });
});

describe("resolveConfig defaults", () => {
  it("populates all fields with defaults and assembles a UA without contact", () => {
    const cfg = resolveConfig();
    expect(cfg.rateMs).toBe(3000);
    expect(cfg.noCache).toBe(false);
    expect(cfg.defaultMaxResults).toBe(25);
    expect(cfg.browserFallback).toBe(false);
    expect(cfg.cacheDir).toMatch(/arxiv-toolkit/);
    expect(cfg.configDir).toMatch(/arxiv-toolkit/);
    expect(cfg.downloadsDir).toBe(join(cfg.configDir.replace(/[^/]+$/, ""), "papers").replace(/config[/\\]?$/, "papers"));
  });

  it("downloadsDir defaults to <data>/papers", () => {
    const cfg = resolveConfig();
    expect(cfg.downloadsDir.endsWith("papers")).toBe(true);
  });

  it("UA starts with arxiv-toolkit/<version> and includes repo url, no mailto when no contact", () => {
    delete process.env.ARXIV_CONTACT;
    const cfg = resolveConfig();
    expect(cfg.userAgent).toMatch(/^arxiv-toolkit\//);
    expect(cfg.userAgent).not.toContain("mailto:");
  });
});

describe("resolveConfig env precedence", () => {
  it("ARXIV_CACHE_DIR overrides cacheDir", () => {
    process.env.ARXIV_CACHE_DIR = "/tmp/custom-cache";
    expect(resolveConfig().cacheDir).toBe("/tmp/custom-cache");
  });

  it("ARXIV_DOWNLOADS_DIR overrides downloadsDir", () => {
    process.env.ARXIV_DOWNLOADS_DIR = "/tmp/custom-dl";
    expect(resolveConfig().downloadsDir).toBe("/tmp/custom-dl");
  });

  it("ARXIV_RATE_MS parses an integer", () => {
    process.env.ARXIV_RATE_MS = "1500";
    expect(resolveConfig().rateMs).toBe(1500);
  });

  it("ARXIV_NO_CACHE truthy variants set noCache true", () => {
    for (const v of ["1", "true", "TRUE", "yes"]) {
      process.env.ARXIV_NO_CACHE = v;
      expect(resolveConfig().noCache).toBe(true);
    }
    process.env.ARXIV_NO_CACHE = "0";
    expect(resolveConfig().noCache).toBe(false);
  });

  it("ARXIV_MAX_RESULTS parses an integer", () => {
    process.env.ARXIV_MAX_RESULTS = "50";
    expect(resolveConfig().defaultMaxResults).toBe(50);
  });

  it("ARXIV_BROWSER truthy sets browserFallback true", () => {
    process.env.ARXIV_BROWSER = "1";
    expect(resolveConfig().browserFallback).toBe(true);
    process.env.ARXIV_BROWSER = "0";
    expect(resolveConfig().browserFallback).toBe(false);
  });

  it("ARXIV_CONTACT adds the mailto segment to the UA", () => {
    process.env.ARXIV_CONTACT = "dev@example.com";
    const cfg = resolveConfig();
    expect(cfg.userAgent).toContain("mailto:dev@example.com");
    expect(cfg.contact).toBe("dev@example.com");
  });

  it("ARXIV_USER_AGENT overrides the entire UA string", () => {
    process.env.ARXIV_USER_AGENT = "custom-agent/1.0";
    expect(resolveConfig().userAgent).toBe("custom-agent/1.0");
  });
});

describe("resolveConfig overrides > env > file", () => {
  it("explicit overrides win over env", () => {
    process.env.ARXIV_RATE_MS = "1500";
    expect(resolveConfig({ rateMs: 9000 }).rateMs).toBe(9000);
  });

  it("env wins over config file", () => {
    // Point env-paths config dir at our temp dir by writing config.json into
    // the real default config dir is non-portable; instead use overrides for
    // configDir to relocate the file, then set a file value and assert env beats it.
    process.env.ARXIV_RATE_MS = "1500";
    writeFileSync(join(tempConfigDir, "config.json"), JSON.stringify({ rateMs: 7777 }));
    expect(resolveConfig({ configDir: tempConfigDir }).rateMs).toBe(1500);
  });

  it("config file applies when no env or override is set", () => {
    writeFileSync(join(tempConfigDir, "config.json"), JSON.stringify({ rateMs: 7777 }));
    expect(resolveConfig({ configDir: tempConfigDir }).rateMs).toBe(7777);
  });

  it("config file unknown keys are ignored and malformed file is treated as empty", () => {
    writeFileSync(
      join(tempConfigDir, "config.json"),
      JSON.stringify({ rateMs: 7777, bogus: "x" }),
    );
    expect(resolveConfig({ configDir: tempConfigDir }).rateMs).toBe(7777);
    writeFileSync(join(tempConfigDir, "config.json"), "{ not valid json");
    expect(resolveConfig({ configDir: tempConfigDir }).rateMs).toBe(3000);
  });

  it("missing config file is treated as empty (no throw)", () => {
    expect(() => resolveConfig({ configDir: tempConfigDir })).not.toThrow();
    expect(resolveConfig({ configDir: tempConfigDir }).rateMs).toBe(3000);
  });
});
```

- [ ] **Step 2: Run the test, expect FAIL.** Run: `npx vitest run test/core/config.test.ts`. Expected: FAIL — `Cannot find module '../../src/core/config.js'`.

- [ ] **Step 3: Implement src/core/config.ts.** Create the file. Complete contents:

```ts
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import envPaths from "env-paths";
import type { ArxivConfig } from "./types.js";

const require = createRequire(import.meta.url);

interface PkgMeta {
  version: string;
  repository?: string | { url?: string };
  author?: string | { email?: string };
}

function readPkg(): PkgMeta {
  // Resolve the project root package.json relative to this source file.
  // __dirname is unavailable in ESM; derive it from import.meta.url.
  const here = dirname(fileURLToPath(import.meta.url));
  // dist/core/config.js -> ../../package.json ; src/core/config.ts -> ../../package.json
  // try a couple of depths so it works both from src (vitest) and dist.
  const candidates = [
    join(here, "..", "..", "package.json"),
    join(here, "..", "..", "..", "package.json"),
  ];
  for (const p of candidates) {
    try {
      return require(p) as PkgMeta;
    } catch {
      // try next
    }
  }
  return { version: "0.0.0" };
}

function repoUrl(pkg: PkgMeta): string {
  if (!pkg.repository) return "https://github.com/anthropics/arxiv-toolkit";
  if (typeof pkg.repository === "string") return pkg.repository;
  return pkg.repository.url ?? "https://github.com/anthropics/arxiv-toolkit";
}

function authorEmail(pkg: PkgMeta): string | undefined {
  if (!pkg.author) return undefined;
  if (typeof pkg.author === "string") {
    const m = pkg.author.match(/<([^>]+)>/);
    return m ? m[1] : undefined;
  }
  return pkg.author.email;
}

function isTruthy(v: string | undefined): boolean {
  if (v === undefined) return false;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

function readConfigFile(configDir: string): Partial<ArxivConfig> {
  try {
    const raw = readFileSync(join(configDir, "config.json"), "utf8");
    return JSON.parse(raw) as Partial<ArxivConfig>;
  } catch {
    return {};
  }
}

function buildUserAgent(pkg: PkgMeta, contact?: string): string {
  const repo = repoUrl(pkg);
  if (contact && contact.length > 0) {
    return `arxiv-toolkit/${pkg.version} (+${repo}; mailto:${contact})`;
  }
  return `arxiv-toolkit/${pkg.version} (+${repo})`;
}

/**
 * Resolve a fully-populated ArxivConfig.
 * Precedence: overrides > env vars > config file > defaults.
 */
export function resolveConfig(overrides?: Partial<ArxivConfig>): ArxivConfig {
  const pkg = readPkg();
  const paths = envPaths("arxiv-toolkit", { suffix: "" });

  const defaults: ArxivConfig = {
    cacheDir: paths.cache,
    downloadsDir: join(paths.data, "papers"),
    configDir: paths.config,
    rateMs: 3000,
    userAgent: "",
    contact: undefined,
    noCache: false,
    defaultMaxResults: 25,
    browserFallback: false,
  };

  // configDir must be resolved from overrides/env/file/default BEFORE we read
  // the file, so resolve it in its own mini-pipeline.
  const configDirFromEnv = process.env.ARXIV_CACHE_DIR ? undefined : undefined; // no env for configDir in the contract; keep default unless overridden
  void configDirFromEnv;
  let configDir: string = defaults.configDir;
  if (overrides?.configDir) configDir = overrides.configDir;
  const file = readConfigFile(configDir);

  const fromEnv: Partial<ArxivConfig> = {};
  if (process.env.ARXIV_CACHE_DIR) fromEnv.cacheDir = process.env.ARXIV_CACHE_DIR;
  if (process.env.ARXIV_DOWNLOADS_DIR) fromEnv.downloadsDir = process.env.ARXIV_DOWNLOADS_DIR;
  if (process.env.ARXIV_RATE_MS) fromEnv.rateMs = Number(process.env.ARXIV_RATE_MS);
  if (process.env.ARXIV_MAX_RESULTS) fromEnv.defaultMaxResults = Number(process.env.ARXIV_MAX_RESULTS);
  if (process.env.ARXIV_NO_CACHE) fromEnv.noCache = isTruthy(process.env.ARXIV_NO_CACHE);
  if (process.env.ARXIV_BROWSER) fromEnv.browserFallback = isTruthy(process.env.ARXIV_BROWSER);
  if (process.env.ARXIV_CONTACT) fromEnv.contact = process.env.ARXIV_CONTACT;
  if (process.env.ARXIV_USER_AGENT) fromEnv.userAgent = process.env.ARXIV_USER_AGENT;

  const merged: ArxivConfig = {
    ...defaults,
    ...file,
    ...fromEnv,
    ...(overrides ?? {}),
    configDir,
  } as ArxivConfig;

  // User-Agent: ARXIV_USER_AGENT (already in merged) wins; otherwise assemble.
  if (!merged.userAgent || !process.env.ARXIV_USER_AGENT) {
    const contact = merged.contact ?? authorEmail(pkg);
    merged.userAgent = buildUserAgent(pkg, contact);
    if (contact && !merged.contact) merged.contact = contact;
  }

  return merged;
}
```

- [ ] **Step 4: Run the test, expect PASS.** Run: `npx vitest run test/core/config.test.ts`. Expected: PASS — defaults, env precedence, and override>env>file ordering all green, UA assembly correct with and without contact. If the "downloadsDir defaults to <data>/papers" assertion fails because env-paths' `data` path differs across platforms, adjust only the loose assertion in the test (the contract pins `downloadsDir = <data>/papers`; keep the implementation's `join(paths.data, "papers")`).

- [ ] **Step 5: Run both new test files together and typecheck.** Run: `npx vitest run test/core/ids.test.ts test/core/config.test.ts`. Expected: PASS. Run: `npx tsc --noEmit`. Expected: PASS (no errors originating in `src/core/config.ts` or `test/core/config.test.ts`).

- [ ] **Step 6: Commit.** Run:
```
git add src/core/config.ts test/core/config.test.ts && git commit -m "feat(core): add resolveConfig with env-paths, precedence, and UA assembly

- resolveConfig merges overrides > env > config file > defaults.
- Paths via env-paths('arxiv-toolkit',{suffix:''}); downloads default to <data>/papers.
- UA assembled as arxiv-toolkit/<version> (+<repo>; mailto:<contact>), dropping
  the mailto segment when no contact is available; ARXIV_USER_AGENT overrides all.
- Config file unknown keys ignored; missing/malformed file treated as empty.
"
```
---

## Phase 3: HTTP + rate-limit + cache

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
---

## Phase 4: Search core

<!-- Phase: Search core -->

### Task A: Atom feed parser (src/core/parse/atom.ts)

**Files:**
- Test: `/Users/aildan/arxiv/test/core/parse/atom.test.ts` (Create)
- Fixtures: `/Users/aildan/arxiv/test/fixtures/atom-single.xml`, `/Users/aildan/arxiv/test/fixtures/atom-multi.xml` (Create)
- Source: `/Users/aildan/arxiv/src/core/parse/atom.ts` (Create)
- Commit: `src/core/parse/atom.ts`, `test/core/parse/atom.test.ts`, `test/fixtures/atom-single.xml`, `test/fixtures/atom-multi.xml`

**Interfaces:**
- Consumes: `Paper`, `Author`, `SearchResult` from `../types.js` (via `../../src/core/types.js` in tests); `normalizeId` from `../ids.js`; `ParseError` from `../errors.js`; `fast-xml-parser` (`XMLParser`).
- Produces: `export function parseFeed(xml: string): SearchResult` — maps OpenSearch `totalResults`/`startIndex`/`itemsPerPage` → `total`/`start`/`count`, and each Atom `entry` → `Paper`. Entry `id` (an abs URL incl. version) is reduced to the bare id via `normalizeId`, yielding `id`/`version`/`idWithVersion`. `title`/`summary` are trimmed; `author` → `{ name, affiliation? }`; `category[@term]` → `categories[]`; `primary_category[@term]` → `primaryCategory`; `published`/`updated` carried verbatim; optional `doi`/`journal_ref`/`comment`; `links` from the `link` array (`abs` = the `rel=alternate` `text/html` link or the entry id; `pdf` = the `title=pdf` link; `html` set only if a `rel=related type=text/html` link other than the abs is present).

**Notes for the implementer:** Use `fast-xml-parser` configured with `removeNSPrefix: true` (so `opensearch:totalResults`/`arxiv:primary_category` become `totalResults`/`primary_category`), `ignoreAttributes: false` (so `@_term`/`@_rel`/`@_href`/`@_title` survive), and the **predicate** `isArray: (name) => ["entry","author","category","link"].includes(name)` (NOT a blanket `() => true` — that over-applies and breaks the structure). A single-entry feed must still yield `entry` as a one-element array; the fixtures lock that. `feed.entry` may be absent on a zero-result feed → treat as `[]`. Attribute access uses the default `@_` prefix.

- [ ] **Step 1: Write the two Atom fixtures.** Create `test/fixtures/atom-single.xml` (one entry, namespaced fields, affiliation present, doi + journal_ref + comment present):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"
      xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/"
      xmlns:arxiv="http://arxiv.org/schemas/atom">
  <link href="http://export.arxiv.org/api/query?search_query%3Dall:mistral" rel="self" type="application/atom+xml"/>
  <title type="html">ArXiv Query: search_query=all:mistral</title>
  <id>http://export.arxiv.org/api/abc</id>
  <updated>2023-10-10T00:00:00-04:00</updated>
  <opensearch:totalResults xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">1</opensearch:totalResults>
  <opensearch:startIndex xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">0</opensearch:startIndex>
  <opensearch:itemsPerPage xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">1</opensearch:itemsPerPage>
  <entry>
    <id>http://arxiv.org/abs/2310.06825v1</id>
    <updated>2023-10-10T17:54:09Z</updated>
    <published>2023-10-10T17:54:09Z</published>
    <title>Mistral 7B</title>
    <summary>  We introduce Mistral 7B, a 7-billion-parameter language model. </summary>
    <author>
      <name>Albert Q. Jiang</name>
      <arxiv:affiliation xmlns:arxiv="http://arxiv.org/schemas/atom">Mistral AI</arxiv:affiliation>
    </author>
    <author>
      <name>Alexandre Sablayrolles</name>
    </author>
    <arxiv:doi xmlns:arxiv="http://arxiv.org/schemas/atom">10.1000/xyz123</arxiv:doi>
    <link title="doi" href="http://dx.doi.org/10.1000/xyz123" rel="related"/>
    <arxiv:comment xmlns:arxiv="http://arxiv.org/schemas/atom">Models and code available</arxiv:comment>
    <arxiv:journal_ref xmlns:arxiv="http://arxiv.org/schemas/atom">Proc. of FooConf 2023</arxiv:journal_ref>
    <link href="http://arxiv.org/abs/2310.06825v1" rel="alternate" type="text/html"/>
    <link title="pdf" href="http://arxiv.org/pdf/2310.06825v1" rel="related" type="application/pdf"/>
    <arxiv:primary_category xmlns:arxiv="http://arxiv.org/schemas/atom" term="cs.CL" scheme="http://arxiv.org/schemas/atom"/>
    <category term="cs.CL" scheme="http://arxiv.org/schemas/atom"/>
    <category term="cs.AI" scheme="http://arxiv.org/schemas/atom"/>
    <category term="cs.LG" scheme="http://arxiv.org/schemas/atom"/>
  </entry>
</feed>
```

Create `test/fixtures/atom-multi.xml` (two entries; the second has no affiliation, no doi/journal_ref/comment, a single category, and an old-style id — locking the `isArray` shape and `normalizeId` reuse):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"
      xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/"
      xmlns:arxiv="http://arxiv.org/schemas/atom">
  <title type="html">ArXiv Query: search_query=cat:cs.CL</title>
  <id>http://export.arxiv.org/api/def</id>
  <updated>2023-10-10T00:00:00-04:00</updated>
  <opensearch:totalResults xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">42</opensearch:totalResults>
  <opensearch:startIndex xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">0</opensearch:startIndex>
  <opensearch:itemsPerPage xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">2</opensearch:itemsPerPage>
  <entry>
    <id>http://arxiv.org/abs/2310.06825v1</id>
    <updated>2023-10-10T17:54:09Z</updated>
    <published>2023-10-10T17:54:09Z</published>
    <title>Mistral 7B</title>
    <summary>We introduce Mistral 7B.</summary>
    <author>
      <name>Albert Q. Jiang</name>
    </author>
    <link href="http://arxiv.org/abs/2310.06825v1" rel="alternate" type="text/html"/>
    <link title="pdf" href="http://arxiv.org/pdf/2310.06825v1" rel="related" type="application/pdf"/>
    <arxiv:primary_category xmlns:arxiv="http://arxiv.org/schemas/atom" term="cs.CL" scheme="http://arxiv.org/schemas/atom"/>
    <category term="cs.CL" scheme="http://arxiv.org/schemas/atom"/>
    <category term="cs.AI" scheme="http://arxiv.org/schemas/atom"/>
  </entry>
  <entry>
    <id>http://arxiv.org/abs/cond-mat/0011267v2</id>
    <updated>2000-11-15T18:00:00Z</updated>
    <published>2000-11-15T18:00:00Z</published>
    <title>An Old-Style Paper</title>
    <summary>A historical condensed-matter abstract.</summary>
    <author>
      <name>Jane Doe</name>
    </author>
    <link href="http://arxiv.org/abs/cond-mat/0011267v2" rel="alternate" type="text/html"/>
    <link title="pdf" href="http://arxiv.org/pdf/cond-mat/0011267v2" rel="related" type="application/pdf"/>
    <arxiv:primary_category xmlns:arxiv="http://arxiv.org/schemas/atom" term="cond-mat" scheme="http://arxiv.org/schemas/atom"/>
    <category term="cond-mat" scheme="http://arxiv.org/schemas/atom"/>
  </entry>
</feed>
```

- [ ] **Step 2: Write the failing parser test.** Create `test/core/parse/atom.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFeed } from "../../../src/core/parse/atom.js";

const fixture = (name: string): string =>
  readFileSync(join(__dirname, "..", "..", "fixtures", name), "utf8");

describe("parseFeed (single entry)", () => {
  const result = parseFeed(fixture("atom-single.xml"));

  it("maps OpenSearch paging fields", () => {
    expect(result.total).toBe(1);
    expect(result.start).toBe(0);
    expect(result.count).toBe(1);
  });

  it("wraps a single entry into a one-element papers array (isArray shape)", () => {
    expect(Array.isArray(result.papers)).toBe(true);
    expect(result.papers).toHaveLength(1);
  });

  it("derives canonical id, version, and idWithVersion from the entry id URL", () => {
    const p = result.papers[0];
    expect(p.id).toBe("2310.06825");
    expect(p.version).toBe(1);
    expect(p.idWithVersion).toBe("2310.06825v1");
  });

  it("trims title and summary", () => {
    const p = result.papers[0];
    expect(p.title).toBe("Mistral 7B");
    expect(p.summary).toBe(
      "We introduce Mistral 7B, a 7-billion-parameter language model.",
    );
  });

  it("maps authors with optional affiliation", () => {
    const p = result.papers[0];
    expect(p.authors).toEqual([
      { name: "Albert Q. Jiang", affiliation: "Mistral AI" },
      { name: "Alexandre Sablayrolles" },
    ]);
  });

  it("maps categories and primary category", () => {
    const p = result.papers[0];
    expect(p.categories).toEqual(["cs.CL", "cs.AI", "cs.LG"]);
    expect(p.primaryCategory).toBe("cs.CL");
  });

  it("carries published/updated and optional doi/journalRef/comment", () => {
    const p = result.papers[0];
    expect(p.published).toBe("2023-10-10T17:54:09Z");
    expect(p.updated).toBe("2023-10-10T17:54:09Z");
    expect(p.doi).toBe("10.1000/xyz123");
    expect(p.journalRef).toBe("Proc. of FooConf 2023");
    expect(p.comment).toBe("Models and code available");
  });

  it("maps abs and pdf links", () => {
    const p = result.papers[0];
    expect(p.links.abs).toBe("http://arxiv.org/abs/2310.06825v1");
    expect(p.links.pdf).toBe("http://arxiv.org/pdf/2310.06825v1");
  });
});

describe("parseFeed (multi entry)", () => {
  const result = parseFeed(fixture("atom-multi.xml"));

  it("maps paging and parses every entry", () => {
    expect(result.total).toBe(42);
    expect(result.papers).toHaveLength(2);
  });

  it("preserves document order", () => {
    expect(result.papers[0].id).toBe("2310.06825");
    expect(result.papers[1].id).toBe("cond-mat/0011267");
  });

  it("handles an old-style id (slash kept) with version", () => {
    const p = result.papers[1];
    expect(p.id).toBe("cond-mat/0011267");
    expect(p.version).toBe(2);
    expect(p.idWithVersion).toBe("cond-mat/0011267v2");
  });

  it("leaves optional fields undefined when absent", () => {
    const p = result.papers[1];
    expect(p.doi).toBeUndefined();
    expect(p.journalRef).toBeUndefined();
    expect(p.comment).toBeUndefined();
    expect(p.authors).toEqual([{ name: "Jane Doe" }]);
  });

  it("single-category entry still yields an array", () => {
    expect(result.papers[1].categories).toEqual(["cond-mat"]);
  });
});

describe("parseFeed (zero results)", () => {
  const empty = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">
  <opensearch:totalResults>0</opensearch:totalResults>
  <opensearch:startIndex>0</opensearch:startIndex>
  <opensearch:itemsPerPage>0</opensearch:itemsPerPage>
</feed>`;

  it("returns empty papers without throwing", () => {
    const result = parseFeed(empty);
    expect(result.total).toBe(0);
    expect(result.papers).toEqual([]);
  });
});
```

- [ ] **Step 3: Run the test, expect FAIL.** Run: `npx vitest run test/core/parse/atom.test.ts`. Expected: FAIL — `Cannot find module '../../../src/core/parse/atom.js'`.

- [ ] **Step 4: Implement src/core/parse/atom.ts.** Create the file. Complete contents:

```ts
import { XMLParser } from "fast-xml-parser";
import { normalizeId } from "../ids.js";
import { ParseError } from "../errors.js";
import type { Author, Paper, SearchResult } from "../types.js";

const parser = new XMLParser({
  removeNSPrefix: true,
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  // Predicate (NOT a blanket () => true): force these elements to arrays so a
  // single-entry feed still yields entry/author/category/link as arrays.
  isArray: (name) => ["entry", "author", "category", "link"].includes(name),
});

const asArray = <T>(v: T | T[] | undefined): T[] =>
  v === undefined ? [] : Array.isArray(v) ? v : [v];

/** fast-xml-parser yields a string for text nodes, or an object with #text when
 * attributes are present. Normalize to a trimmed string (or undefined). */
const textOf = (v: unknown): string | undefined => {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return String(v);
  if (typeof v === "object" && "#text" in (v as Record<string, unknown>)) {
    const t = (v as Record<string, unknown>)["#text"];
    return t === undefined ? undefined : String(t).trim();
  }
  return undefined;
};

const num = (v: unknown): number => {
  const n = Number(textOf(v) ?? v);
  return Number.isFinite(n) ? n : 0;
};

interface RawLink {
  "@_href"?: string;
  "@_rel"?: string;
  "@_type"?: string;
  "@_title"?: string;
}

interface RawAuthor {
  name?: unknown;
  affiliation?: unknown;
}

interface RawCategory {
  "@_term"?: string;
}

interface RawEntry {
  id?: unknown;
  title?: unknown;
  summary?: unknown;
  published?: unknown;
  updated?: unknown;
  author?: RawAuthor[];
  category?: RawCategory[];
  primary_category?: { "@_term"?: string };
  doi?: unknown;
  journal_ref?: unknown;
  comment?: unknown;
  link?: RawLink[];
}

function mapAuthors(raw: RawAuthor[]): Author[] {
  return raw.map((a) => {
    const author: Author = { name: textOf(a.name) ?? "" };
    const aff = textOf(a.affiliation);
    if (aff) author.affiliation = aff;
    return author;
  });
}

function mapLinks(
  raw: RawLink[],
  entryId: string,
): Paper["links"] {
  let abs: string | undefined;
  let pdf: string | undefined;
  let html: string | undefined;
  for (const l of raw) {
    const href = l["@_href"];
    if (!href) continue;
    if (l["@_title"] === "pdf") {
      pdf = href;
    } else if (l["@_rel"] === "alternate" && l["@_type"] === "text/html") {
      abs = href;
    } else if (
      l["@_rel"] === "related" &&
      l["@_type"] === "text/html" &&
      l["@_title"] !== "pdf"
    ) {
      html = href;
    }
  }
  const links: Paper["links"] = {
    abs: abs ?? entryId,
    pdf: pdf ?? entryId.replace("/abs/", "/pdf/"),
  };
  if (html) links.html = html;
  return links;
}

function mapEntry(e: RawEntry): Paper {
  const rawId = textOf(e.id);
  if (!rawId) throw new ParseError("Atom entry is missing an id");
  const norm = normalizeId(rawId);

  const paper: Paper = {
    id: norm.id,
    title: textOf(e.title) ?? "",
    summary: textOf(e.summary) ?? "",
    authors: mapAuthors(asArray(e.author)),
    categories: asArray(e.category)
      .map((c) => c["@_term"])
      .filter((t): t is string => typeof t === "string"),
    primaryCategory: e.primary_category?.["@_term"] ?? "",
    published: textOf(e.published) ?? "",
    updated: textOf(e.updated) ?? "",
    links: mapLinks(asArray(e.link), rawId),
  };

  if (norm.version !== undefined) {
    paper.version = norm.version;
    paper.idWithVersion = norm.idWithVersion;
  }
  const doi = textOf(e.doi);
  if (doi) paper.doi = doi;
  const journalRef = textOf(e.journal_ref);
  if (journalRef) paper.journalRef = journalRef;
  const comment = textOf(e.comment);
  if (comment) paper.comment = comment;

  return paper;
}

/** Parse an arXiv Atom feed into a SearchResult (paging + papers). */
export function parseFeed(xml: string): SearchResult {
  let doc: { feed?: Record<string, unknown> };
  try {
    doc = parser.parse(xml) as { feed?: Record<string, unknown> };
  } catch (err) {
    throw new ParseError(`Failed to parse Atom feed: ${String(err)}`);
  }
  const feed = doc.feed;
  if (!feed) throw new ParseError("Atom feed has no <feed> root");

  const entries = asArray(feed.entry as RawEntry | RawEntry[] | undefined);
  return {
    total: num(feed.totalResults),
    start: num(feed.startIndex),
    count: num(feed.itemsPerPage),
    papers: entries.map(mapEntry),
  };
}
```

- [ ] **Step 5: Run the test, expect PASS.** Run: `npx vitest run test/core/parse/atom.test.ts`. Expected: PASS — single- and multi-entry parsing, namespaced fields, old-style id, optional-field omission, zero-result feed.

- [ ] **Step 6: Run typecheck.** Run: `npx tsc --noEmit`. Expected: PASS (no errors originating in `src/core/parse/atom.ts`).

- [ ] **Step 7: Commit.** Run:
```
git add src/core/parse/atom.ts test/core/parse/atom.test.ts test/fixtures/atom-single.xml test/fixtures/atom-multi.xml && git commit -m "feat(core): parse arXiv Atom feeds into SearchResult

- parseFeed maps OpenSearch totalResults/startIndex/itemsPerPage and each
  entry into a Paper (canonical id/version via normalizeId, authors with
  optional affiliation, categories, primary category, links, optional
  doi/journal_ref/comment).
- fast-xml-parser configured with removeNSPrefix, ignoreAttributes:false, and
  the isArray predicate for entry/author/category/link (not a blanket predicate).
- Single- and multi-entry fixtures lock the array shape; zero-result feed safe.
"
```

---

### Task B: DataSource interface + ApiDataSource (src/core/datasource/datasource.ts, src/core/datasource/api.ts)

**Files:**
- Source: `/Users/aildan/arxiv/src/core/datasource/datasource.ts` (Create)
- Source: `/Users/aildan/arxiv/src/core/datasource/api.ts` (Create)
- Test: `/Users/aildan/arxiv/test/core/datasource/api.test.ts` (Create)
- Commit: `src/core/datasource/datasource.ts`, `src/core/datasource/api.ts`, `test/core/datasource/api.test.ts`

**Interfaces:**
- Consumes: `Http` from `../http.js` (`getText(url): Promise<string|null>`, `getBytes(url): Promise<Uint8Array>`); `NetworkError`, `NotFoundError` from `../errors.js`.
- Produces:
  - `export interface DataSource` — the frozen transport seam (contracts §3): `query(url): Promise<string>`, `getHtml(url): Promise<string | null>`, `getPdf(url): Promise<Uint8Array>`, `getText(url): Promise<string>`.
  - `export class ApiDataSource implements DataSource` — `constructor(http: Http)`; `query` → `http.getText`, throw `NetworkError` if `null`; `getHtml` → `http.getText` (passes `null` through); `getPdf` → `http.getBytes`; `getText` → `http.getText`, throw `NotFoundError` if `null`.

**Notes for the implementer:** `datasource.ts` is the frozen interface transcribed verbatim from contracts §3 — it builds nothing and parses nothing. The client owns URL building and fallback order. `ApiDataSource` is a thin wrapper; the test injects a hand-rolled fake `Http` (only `getText`/`getBytes` need to exist) rather than the real `Http`, so no network and no `RateLimiter`.

- [ ] **Step 1: Write the frozen DataSource interface.** Create `src/core/datasource/datasource.ts`. Complete contents (verbatim from contracts §3):

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

- [ ] **Step 2: Write the failing ApiDataSource test.** Create `test/core/datasource/api.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { ApiDataSource } from "../../../src/core/datasource/api.js";
import type { Http } from "../../../src/core/http.js";

function fakeHttp(over: Partial<Http> = {}): Http {
  return {
    getText: vi.fn(async () => null),
    getBytes: vi.fn(async () => new Uint8Array()),
    ...over,
  } as unknown as Http;
}

describe("ApiDataSource", () => {
  it("query returns the Atom text from http.getText", async () => {
    const http = fakeHttp({ getText: vi.fn(async () => "<feed/>") as Http["getText"] });
    const ds = new ApiDataSource(http);
    expect(await ds.query("https://export.arxiv.org/api/query?x=1")).toBe("<feed/>");
  });

  it("query throws NetworkError when http.getText returns null (404)", async () => {
    const http = fakeHttp({ getText: vi.fn(async () => null) as Http["getText"] });
    const ds = new ApiDataSource(http);
    await expect(ds.query("https://export.arxiv.org/api/query?x=1")).rejects.toMatchObject({
      code: "NETWORK",
    });
  });

  it("getHtml passes null through on 404", async () => {
    const http = fakeHttp({ getText: vi.fn(async () => null) as Http["getText"] });
    const ds = new ApiDataSource(http);
    expect(await ds.getHtml("https://arxiv.org/html/0000.00000")).toBeNull();
  });

  it("getHtml returns the HTML body on 200", async () => {
    const http = fakeHttp({ getText: vi.fn(async () => "<html/>") as Http["getText"] });
    const ds = new ApiDataSource(http);
    expect(await ds.getHtml("https://arxiv.org/html/2310.06825")).toBe("<html/>");
  });

  it("getPdf delegates to http.getBytes", async () => {
    const bytes = new Uint8Array([37, 80, 68, 70]);
    const http = fakeHttp({ getBytes: vi.fn(async () => bytes) as Http["getBytes"] });
    const ds = new ApiDataSource(http);
    expect(await ds.getPdf("https://arxiv.org/pdf/2310.06825.pdf")).toBe(bytes);
  });

  it("getText returns the text on 200", async () => {
    const http = fakeHttp({ getText: vi.fn(async () => "@misc{...}") as Http["getText"] });
    const ds = new ApiDataSource(http);
    expect(await ds.getText("https://arxiv.org/bibtex/2310.06825")).toBe("@misc{...}");
  });

  it("getText throws NotFoundError when http.getText returns null (404)", async () => {
    const http = fakeHttp({ getText: vi.fn(async () => null) as Http["getText"] });
    const ds = new ApiDataSource(http);
    await expect(ds.getText("https://arxiv.org/bibtex/0000.00000")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
```

- [ ] **Step 3: Run the test, expect FAIL.** Run: `npx vitest run test/core/datasource/api.test.ts`. Expected: FAIL — `Cannot find module '../../../src/core/datasource/api.js'`.

- [ ] **Step 4: Implement src/core/datasource/api.ts.** Create the file. Complete contents:

```ts
import { NetworkError, NotFoundError } from "../errors.js";
import type { Http } from "../http.js";
import type { DataSource } from "./datasource.js";

/**
 * Default DataSource over arXiv's official endpoints. A thin transport: it
 * builds no URLs and parses nothing — the client decides URLs and fallback
 * order; parsing lives in core/parse/*.
 */
export class ApiDataSource implements DataSource {
  private readonly http: Http;

  constructor(http: Http) {
    this.http = http;
  }

  async query(url: string): Promise<string> {
    const text = await this.http.getText(url);
    if (text === null) {
      throw new NetworkError(`Query endpoint returned no body: ${url}`);
    }
    return text;
  }

  async getHtml(url: string): Promise<string | null> {
    return this.http.getText(url);
  }

  async getPdf(url: string): Promise<Uint8Array> {
    return this.http.getBytes(url);
  }

  async getText(url: string): Promise<string> {
    const text = await this.http.getText(url);
    if (text === null) {
      throw new NotFoundError(`Not found: ${url}`);
    }
    return text;
  }
}
```

- [ ] **Step 5: Run the test, expect PASS.** Run: `npx vitest run test/core/datasource/api.test.ts`. Expected: PASS — query/getHtml/getPdf/getText delegation and 404 semantics (query→NetworkError, getHtml→null, getText→NotFoundError) all green.

- [ ] **Step 6: Run typecheck.** Run: `npx tsc --noEmit`. Expected: PASS (no errors originating in `src/core/datasource/*.ts`).

- [ ] **Step 7: Commit.** Run:
```
git add src/core/datasource/datasource.ts src/core/datasource/api.ts test/core/datasource/api.test.ts && git commit -m "feat(core): add DataSource seam and ApiDataSource transport

- datasource.ts: frozen DataSource interface (query/getHtml/getPdf/getText).
- ApiDataSource wraps Http: query->getText (NetworkError on null),
  getHtml->getText passthrough, getPdf->getBytes, getText->getText
  (NotFoundError on null).
- Tested with an injected fake Http (no network).
"
```

---

### Task C: Search query builder + ArxivClient (src/core/client.ts)

**Files:**
- Source: `/Users/aildan/arxiv/src/core/client.ts` (Create — skeleton + Phase 4 methods)
- Test: `/Users/aildan/arxiv/test/core/client.test.ts` (Create)
- Commit: `src/core/client.ts`, `test/core/client.test.ts`

**Interfaces:**
- Consumes: `resolveConfig` from `./config.js`; `RateLimiter` from `./rate-limit.js`; `Cache` from `./cache.js`; `Http` from `./http.js`; `ApiDataSource` from `./datasource/api.js`; `DataSource` (type) from `./datasource/datasource.js`; `parseFeed` from `./parse/atom.js`; `normalizeId` from `./ids.js`; `ParseError` from `./errors.js`; all domain types from `./types.js`.
- Produces: `export class ArxivClient` with the **exact** constructor/field set from contracts §4, plus implemented `search`/`getPaper`/`getPapers`/`recent` and the frozen one-line stub bodies for `getContent`/`download`/`toBibTeX`.

**Notes for the implementer:**
- **Constructor wiring is frozen** (contracts §4): `Http` is built **without** a cache; the client owns the structured `Cache` (or `undefined` when `noCache`). Do not pass `this.cache` into `Http`.
- **search_query builder (spec §7.1):** `query` → `all:"<query>"`; each provided field → `ti:`/`au:`/`abs:`/`cat:` clause; all clauses ANDed. **If neither `query` nor any field clause is produced AND no `ids` are given → throw `ParseError`** (usage error). A search with only `ids` (and no query/fields) is valid (id_list lookup) and emits **no** `search_query`.
- **Term encoding (spec §5.1):** wrap each clause's term in `%22…%22` (the encoded double-quote) so multi-word phrases group; within the quoted term, spaces → `+`, `(` → `%28`, `)` → `%29`. Clauses are joined with `+AND+`. The whole `search_query` value is emitted **pre-encoded** (do not run it through `encodeURIComponent` again). `id_list` is the raw comma-joined canonical ids (slash kept, never `%2F`). `start`/`max_results`/`sortBy`/`sortOrder` are appended as plain params.
- **maxResults:** default from `cfg.defaultMaxResults`; clamp to ≤ 2000 (fixed constant). `start` defaults to 0.
- **hints:** when `total > 1000`, push one hint string ("N results — narrow by category/date").
- **recent:** delegates to `search({ category, sortBy: "submittedDate", sortOrder: "descending", maxResults })`.
- **getPapers:** chunk `ids` into ≤ 50 per `id_list` request; concatenate parsed papers; **return in input order** (sort the union by the input index, dropping ids arXiv did not return); ids omitted by arXiv are collected and surfaced via a single `console.warn` (no throw). `getPaper` = first element of `getPapers([id])`, or `NotFoundError` if empty.
- **Caching (contracts §6):** search → key `{ kind: "search", paramsHash }`, TTL 1h (`this.cache?.get`/`set`, guarded). metadata → key `{ kind: "meta", id, version }`. `paramsHash` is the normalized param object; pass the object as the key and let `Cache` hash it.
- **Stub bodies are frozen one-liners** so Phases 6/7 replace exactly those lines.

- [ ] **Step 1: Write the failing client test.** Create `test/core/client.test.ts`. It subclasses/constructs `ArxivClient` with `noCache: true` (so `this.cache` is `undefined`) and replaces the private `api` with a fake `DataSource` via a typed cast, capturing the `query` URL.

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ArxivClient } from "../../src/core/client.js";
import type { DataSource } from "../../src/core/datasource/datasource.js";

const fixture = (name: string): string =>
  readFileSync(join(__dirname, "..", "fixtures", name), "utf8");

interface Captured {
  urls: string[];
}

/** Build a client whose ApiDataSource is replaced by a fake that records query
 * URLs and returns the given Atom feeds in sequence (one per query call). */
function clientWithFeeds(feeds: string[]): { client: ArxivClient; cap: Captured } {
  const cap: Captured = { urls: [] };
  const client = new ArxivClient({ noCache: true, defaultMaxResults: 25 });
  let i = 0;
  const fake: DataSource = {
    async query(url: string) {
      cap.urls.push(url);
      const feed = feeds[Math.min(i, feeds.length - 1)];
      i++;
      return feed;
    },
    async getHtml() {
      return null;
    },
    async getPdf() {
      return new Uint8Array();
    },
    async getText() {
      return "";
    },
  };
  // Inject the fake over the private `api` field.
  (client as unknown as { api: DataSource }).api = fake;
  return { client, cap };
}

describe("ArxivClient.search query building", () => {
  it("emits all:<query> for a free-text query", async () => {
    const { client, cap } = clientWithFeeds([fixture("atom-single.xml")]);
    await client.search({ query: "mistral" });
    expect(cap.urls[0]).toContain("search_query=all:%22mistral%22");
    expect(cap.urls[0]).toContain("start=0");
    expect(cap.urls[0]).toContain("max_results=25");
  });

  it("ANDs free-text with field clauses and quotes multi-word terms", async () => {
    const { client, cap } = clientWithFeeds([fixture("atom-single.xml")]);
    await client.search({ query: "language model", author: "Jiang", category: "cs.CL" });
    const url = cap.urls[0];
    expect(url).toContain("all:%22language+model%22");
    expect(url).toContain("au:%22Jiang%22");
    expect(url).toContain("cat:%22cs.CL%22");
    expect(url).toContain("+AND+");
  });

  it("clamps maxResults to 2000", async () => {
    const { client, cap } = clientWithFeeds([fixture("atom-single.xml")]);
    await client.search({ query: "x", maxResults: 9999 });
    expect(cap.urls[0]).toContain("max_results=2000");
  });

  it("uses cfg.defaultMaxResults when maxResults omitted", async () => {
    const cap: Captured = { urls: [] };
    const client = new ArxivClient({ noCache: true, defaultMaxResults: 7 });
    const fake: DataSource = {
      async query(url: string) {
        cap.urls.push(url);
        return fixture("atom-single.xml");
      },
      async getHtml() { return null; },
      async getPdf() { return new Uint8Array(); },
      async getText() { return ""; },
    };
    (client as unknown as { api: DataSource }).api = fake;
    await client.search({ query: "x" });
    expect(cap.urls[0]).toContain("max_results=7");
  });

  it("applies sortBy/sortOrder/start", async () => {
    const { client, cap } = clientWithFeeds([fixture("atom-single.xml")]);
    await client.search({ query: "x", sortBy: "submittedDate", sortOrder: "ascending", start: 50 });
    const url = cap.urls[0];
    expect(url).toContain("sortBy=submittedDate");
    expect(url).toContain("sortOrder=ascending");
    expect(url).toContain("start=50");
  });

  it("throws ParseError when neither query, field, nor ids are given", async () => {
    const { client } = clientWithFeeds([fixture("atom-single.xml")]);
    await expect(client.search({})).rejects.toMatchObject({ code: "PARSE" });
  });

  it("allows an ids-only search (id_list, no search_query)", async () => {
    const { client, cap } = clientWithFeeds([fixture("atom-single.xml")]);
    await client.search({ ids: ["2310.06825"] });
    const url = cap.urls[0];
    expect(url).toContain("id_list=2310.06825");
    expect(url).not.toContain("search_query=");
  });

  it("keeps the literal slash in old-style id_list (no %2F)", async () => {
    const { client, cap } = clientWithFeeds([fixture("atom-multi.xml")]);
    await client.search({ ids: ["cond-mat/0011267"] });
    expect(cap.urls[0]).toContain("id_list=cond-mat/0011267");
    expect(cap.urls[0]).not.toContain("%2F");
  });

  it("parses the feed into a SearchResult", async () => {
    const { client } = clientWithFeeds([fixture("atom-single.xml")]);
    const res = await client.search({ query: "mistral" });
    expect(res.total).toBe(1);
    expect(res.papers[0].id).toBe("2310.06825");
  });
});

describe("ArxivClient.search hints", () => {
  it("pushes a hint when total > 1000", async () => {
    const big = fixture("atom-single.xml").replace(
      ">1</opensearch:totalResults>",
      ">1200</opensearch:totalResults>",
    );
    const { client } = clientWithFeeds([big]);
    const res = await client.search({ query: "transformer" });
    expect(res.total).toBe(1200);
    expect(res.hints?.[0]).toMatch(/narrow/i);
  });

  it("omits hints when total <= 1000", async () => {
    const { client } = clientWithFeeds([fixture("atom-single.xml")]);
    const res = await client.search({ query: "mistral" });
    expect(res.hints).toBeUndefined();
  });
});

describe("ArxivClient.recent", () => {
  it("maps to a submittedDate/descending category search", async () => {
    const { client, cap } = clientWithFeeds([fixture("atom-multi.xml")]);
    await client.recent("cs.CL", { maxResults: 10 });
    const url = cap.urls[0];
    expect(url).toContain("cat:%22cs.CL%22");
    expect(url).toContain("sortBy=submittedDate");
    expect(url).toContain("sortOrder=descending");
    expect(url).toContain("max_results=10");
  });
});

describe("ArxivClient.getPaper(s)", () => {
  it("getPaper returns the single matching Paper", async () => {
    const { client } = clientWithFeeds([fixture("atom-single.xml")]);
    const paper = await client.getPaper("2310.06825");
    expect(paper.id).toBe("2310.06825");
    expect(paper.title).toBe("Mistral 7B");
  });

  it("getPapers returns papers in input order", async () => {
    // atom-multi has 2310.06825 then cond-mat/0011267; request reversed order.
    const { client } = clientWithFeeds([fixture("atom-multi.xml")]);
    const papers = await client.getPapers(["cond-mat/0011267", "2310.06825"]);
    expect(papers.map((p) => p.id)).toEqual(["cond-mat/0011267", "2310.06825"]);
  });

  it("getPapers warns about omitted ids without throwing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { client } = clientWithFeeds([fixture("atom-single.xml")]);
    const papers = await client.getPapers(["2310.06825", "9999.99999"]);
    expect(papers.map((p) => p.id)).toEqual(["2310.06825"]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("getPapers batches into <=50-id requests", async () => {
    const ids = Array.from({ length: 120 }, (_, i) => `2310.${String(10000 + i)}`);
    const cap: Captured = { urls: [] };
    const client = new ArxivClient({ noCache: true });
    const fake: DataSource = {
      async query(url: string) {
        cap.urls.push(url);
        // empty feed (no entries) — we only assert the batching, not the contents
        return `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><opensearch:totalResults xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">0</opensearch:totalResults><opensearch:startIndex xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">0</opensearch:startIndex><opensearch:itemsPerPage xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">0</opensearch:itemsPerPage></feed>`;
      },
      async getHtml() { return null; },
      async getPdf() { return new Uint8Array(); },
      async getText() { return ""; },
    };
    (client as unknown as { api: DataSource }).api = fake;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await client.getPapers(ids);
    warn.mockRestore();
    expect(cap.urls).toHaveLength(3); // 50 + 50 + 20
    expect(cap.urls[0]).toContain("max_results=50");
  });
});

describe("ArxivClient stubs", () => {
  it("getContent/download/toBibTeX throw their phase markers", async () => {
    const { client } = clientWithFeeds([fixture("atom-single.xml")]);
    await expect(client.getContent("2310.06825")).rejects.toThrow("Phase 6");
    await expect(client.download("2310.06825")).rejects.toThrow("Phase 6");
    await expect(client.toBibTeX("2310.06825")).rejects.toThrow("Phase 7");
  });
});
```

- [ ] **Step 2: Run the test, expect FAIL.** Run: `npx vitest run test/core/client.test.ts`. Expected: FAIL — `Cannot find module '../../src/core/client.js'`.

- [ ] **Step 3: Implement src/core/client.ts.** Create the file. Complete contents:

```ts
import { resolveConfig } from "./config.js";
import { RateLimiter } from "./rate-limit.js";
import { Cache } from "./cache.js";
import { Http } from "./http.js";
import { ApiDataSource } from "./datasource/api.js";
import { parseFeed } from "./parse/atom.js";
import { normalizeId } from "./ids.js";
import { NotFoundError, ParseError } from "./errors.js";
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

const API_QUERY_URL = "https://export.arxiv.org/api/query";
const MAX_RESULTS_CLAMP = 2000;
const ID_LIST_BATCH = 50;
const SEARCH_TTL_MS = 60 * 60 * 1000; // 1h
const META_TTL_LATEST_MS = 24 * 60 * 60 * 1000; // 24h

/** Encode a single search term: quote-wrap (group multi-word phrases), spaces
 * to "+", parentheses to their encoded forms. The whole search_query value is
 * emitted pre-encoded (spec §5.1). */
function encodeTerm(term: string): string {
  const inner = term.trim().replace(/\(/g, "%28").replace(/\)/g, "%29").replace(/\s+/g, "+");
  return `%22${inner}%22`;
}

/** Build the pre-encoded search_query value (or "" when only id_list applies). */
function buildSearchQuery(params: SearchParams): string {
  const clauses: string[] = [];
  if (params.query && params.query.trim()) clauses.push(`all:${encodeTerm(params.query)}`);
  if (params.title && params.title.trim()) clauses.push(`ti:${encodeTerm(params.title)}`);
  if (params.author && params.author.trim()) clauses.push(`au:${encodeTerm(params.author)}`);
  if (params.abstract && params.abstract.trim()) clauses.push(`abs:${encodeTerm(params.abstract)}`);
  if (params.category && params.category.trim()) clauses.push(`cat:${encodeTerm(params.category)}`);
  return clauses.join("+AND+");
}

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

  private buildQueryUrl(params: SearchParams): string {
    const searchQuery = buildSearchQuery(params);
    const hasIds = params.ids !== undefined && params.ids.length > 0;
    if (!searchQuery && !hasIds) {
      throw new ParseError(
        "search requires at least one of: query, title, author, abstract, category, or ids",
      );
    }
    const maxResults = Math.min(
      MAX_RESULTS_CLAMP,
      Math.max(1, params.maxResults ?? this.cfg.defaultMaxResults),
    );
    const start = params.start ?? 0;
    const parts: string[] = [];
    if (searchQuery) parts.push(`search_query=${searchQuery}`);
    if (hasIds) {
      // Canonical ids keep the literal slash (old-style) — never %2F.
      const idList = params.ids!.map((id) => normalizeId(id).idWithVersion ?? normalizeId(id).id).join(",");
      parts.push(`id_list=${idList}`);
    }
    parts.push(`start=${start}`);
    parts.push(`max_results=${maxResults}`);
    if (params.sortBy) parts.push(`sortBy=${params.sortBy}`);
    if (params.sortOrder) parts.push(`sortOrder=${params.sortOrder}`);
    return `${API_QUERY_URL}?${parts.join("&")}`;
  }

  async search(params: SearchParams): Promise<SearchResult> {
    const url = this.buildQueryUrl(params); // throws ParseError on empty params
    const cacheKey = { kind: "search" as const, paramsHash: params };
    const cached = await this.cache?.get<SearchResult>(cacheKey);
    if (cached) return cached;

    const xml = await this.api.query(url);
    const result = parseFeed(xml);
    if (result.total > 1000) {
      result.hints = [
        `${result.total} results — narrow by category/date to refine.`,
      ];
    }
    await this.cache?.set(cacheKey, result, SEARCH_TTL_MS);
    return result;
  }

  async getPaper(id: string): Promise<Paper> {
    const papers = await this.getPapers([id]);
    if (papers.length === 0) {
      throw new NotFoundError(`Paper not found: ${id}`);
    }
    return papers[0];
  }

  async getPapers(ids: string[]): Promise<Paper[]> {
    if (ids.length === 0) return [];
    // Fetch in <=50-id batches; collect all returned papers.
    const found = new Map<string, Paper>();
    for (let i = 0; i < ids.length; i += ID_LIST_BATCH) {
      const batch = ids.slice(i, i + ID_LIST_BATCH);
      const result = await this.search({ ids: batch, maxResults: batch.length });
      for (const paper of result.papers) found.set(paper.id, paper);
    }
    // Re-order to input order; drop ids arXiv did not return; warn about omissions.
    const ordered: Paper[] = [];
    const omitted: string[] = [];
    for (const raw of ids) {
      const canonical = normalizeId(raw).id;
      const paper = found.get(canonical);
      if (paper) ordered.push(paper);
      else omitted.push(raw);
    }
    if (omitted.length > 0) {
      console.warn(`arXiv did not return metadata for: ${omitted.join(", ")}`);
    }
    return ordered;
  }

  async recent(category: string, opts?: { maxResults?: number }): Promise<SearchResult> {
    return this.search({
      category,
      sortBy: "submittedDate",
      sortOrder: "descending",
      maxResults: opts?.maxResults,
    });
  }

  // Phase 6:
  async getContent(id: string, opts?: ReadOptions): Promise<PaperContent> { throw new Error("getContent: implemented in Phase 6"); }
  async download(id: string, opts?: DownloadOptions): Promise<{ path: string; bytes: number }> { throw new Error("download: implemented in Phase 6"); }

  // Phase 7:
  async toBibTeX(id: string): Promise<string> { throw new Error("toBibTeX: implemented in Phase 7"); }
}
```

- [ ] **Step 4: Run the test, expect PASS.** Run: `npx vitest run test/core/client.test.ts`. Expected: PASS — query building (all/field clauses, AND, quoting), clamp, default max, sort/start, ids-only, slash kept, parse, hints, recent mapping, getPaper(s) order + omitted-warning + batching, and stub phase markers all green.

- [ ] **Step 5: Run the full core suite and typecheck.** Run: `npx vitest run test/core` then `npx tsc --noEmit`. Expected: PASS (atom, datasource/api, and client suites all green; no type errors originating in `src/core/client.ts`). The frozen stub bodies (`getContent`/`download`/`toBibTeX`) typecheck because they `throw` before returning; the unused `opts`/`id` params are intentional (Phases 6/7 use them).

- [ ] **Step 6: Commit.** Run:
```
git add src/core/client.ts test/core/client.test.ts && git commit -m "feat(core): add ArxivClient with search/getPaper(s)/recent

- search_query builder: all:<query> ANDed with ti/au/abs/cat field clauses,
  multi-word terms quote-wrapped, paren/space encoded, emitted pre-encoded;
  usage error (ParseError) when no query/field/ids given.
- maxResults defaults to cfg.defaultMaxResults, clamped to <=2000; start/sortBy/
  sortOrder applied; id_list keeps the literal old-style slash (no %2F).
- parseFeed -> SearchResult; hint pushed when total > 1000.
- getPapers batches <=50 ids per request, returns input order, warns (no throw)
  on omitted ids; getPaper wraps getPapers; recent maps to submittedDate/desc.
- Structured client-level caching (search key TTL 1h), guarded for noCache.
- getContent/download (Phase 6) and toBibTeX (Phase 7) left as frozen stubs.
"
```

---

## Phase 5: Minimal CLI (arxiv search)

<!-- Phase: Minimal CLI (search) -->

### Task: Search Command Handler

**Files:**
- Create: `src/cli/commands/search.ts`
- Test: `test/cli/commands/search.test.ts`

**Interfaces:**
- Consumes: `ArxivClient.search(params: SearchParams): Promise<SearchResult>` from `src/core/client.ts`; `SearchParams`, `SearchResult` from `src/core/types.ts`; `ArxivError`, `NotFoundError`, `exitCodeFor(err): number` from `src/core/errors.ts`.
- Produces: `interface SearchFlags`; `interface SearchIo`; `function buildSearchParams(query: string|undefined, opts: SearchFlags): SearchParams`; `function formatSearchJson(result: SearchResult): string`; `function formatSearchHuman(result: SearchResult): string`; `function runSearch(client: ArxivClient, query: string|undefined, opts: SearchFlags, io: SearchIo): Promise<number>` (used by the CLI Program Bootstrap).

- [ ] **Step 1: Write failing tests for `buildSearchParams` (mapping + usage error).** Create `test/cli/commands/search.test.ts` with the parameter-mapping and usage-error tests; create a stub `src/cli/commands/search.ts` so the import resolves but the assertions fail.

Create `test/cli/commands/search.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import {
  buildSearchParams,
  formatSearchJson,
  formatSearchHuman,
  runSearch,
} from "../../src/cli/commands/search.js";
import type { ArxivClient } from "../../src/core/client.js";
import type { SearchResult } from "../../src/core/types.js";
import { NotFoundError } from "../../src/core/errors.js";

const result: SearchResult = {
  total: 2,
  start: 0,
  count: 2,
  papers: [
    {
      id: "1706.03762",
      version: 1,
      idWithVersion: "1706.03762v1",
      title: "Attention Is All You Need",
      summary: "...",
      authors: [{ name: "Ashish Vaswani" }, { name: "Noam Shazeer" }],
      categories: ["cs.CL", "cs.AI"],
      primaryCategory: "cs.CL",
      published: "2017-06-12T00:00:00Z",
      updated: "2017-06-19T00:00:00Z",
      links: { abs: "https://arxiv.org/abs/1706.03762", pdf: "https://arxiv.org/pdf/1706.03762" },
    },
    {
      id: "2310.06825",
      title: "Mistral 7B",
      summary: "...",
      authors: [
        { name: "Albert Jiang" },
        { name: "Ludovic Agh" },
        { name: "Guillaume Lample" },
        { name: "Miguel Ferreira" },
      ],
      categories: ["cs.CL"],
      primaryCategory: "cs.CL",
      published: "2023-10-10T00:00:00Z",
      updated: "2023-10-10T00:00:00Z",
      links: { abs: "https://arxiv.org/abs/2310.06825", pdf: "https://arxiv.org/pdf/2310.06825" },
    },
  ],
};

function io() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    api: {
      stdout: (s: string) => {
        out.push(s);
        return true;
      },
      stderr: (s: string) => {
        err.push(s);
        return true;
      },
    },
  };
}

describe("buildSearchParams", () => {
  it("maps query + field filters + sort/order/max/start", () => {
    const p = buildSearchParams("transformer", {
      author: "Vaswani",
      category: "cs.CL",
      sort: "submitted",
      order: "asc",
      max: 10,
      start: 5,
    });
    expect(p).toEqual({
      query: "transformer",
      author: "Vaswani",
      category: "cs.CL",
      sortBy: "submittedDate",
      sortOrder: "ascending",
      maxResults: 10,
      start: 5,
    });
  });

  it("throws a usage error when no query and no field filter is given", () => {
    expect(() => buildSearchParams(undefined, {})).toThrow(/query or at least one field/);
  });
});

describe("formatters", () => {
  it("formatSearchJson serializes the whole result", () => {
    expect(JSON.parse(formatSearchJson(result))).toEqual(result);
  });

  it("formatSearchHuman renders a readable table", () => {
    const text = formatSearchHuman(result);
    expect(text).toContain("Found 2 result(s) (showing 1-2)");
    expect(text).toContain("1. Attention Is All You Need");
    expect(text).toContain("1706.03762 | Ashish Vaswani, Noam Shazeer | cs.CL | 2017-06-12");
    expect(text).toContain("2. Mistral 7B");
    expect(text).toContain("2310.06825 | Albert Jiang et al. | cs.CL | 2023-10-10");
    expect(text.endsWith("\n")).toBe(true);
  });
});

describe("runSearch", () => {
  it("calls client.search with mapped params and prints JSON in --json mode", async () => {
    const client = { search: vi.fn().mockResolvedValue(result) } as unknown as ArxivClient;
    const { out, err, api } = io();
    const code = await runSearch(client, "transformer", { json: true }, api);
    expect(code).toBe(0);
    expect(client.search).toHaveBeenCalledWith({ query: "transformer" });
    expect(JSON.parse(out.join(""))).toEqual(result);
    expect(err).toEqual([]);
  });

  it("prints a human table and writes hints to stderr unless --quiet", async () => {
    const hinted: SearchResult = { ...result, hints: ["Many results — narrow by category/date"] };
    const client = { search: vi.fn().mockResolvedValue(hinted) } as unknown as ArxivClient;
    const a = io();
    await runSearch(client, "x", { quiet: false }, a.api);
    expect(a.out.join("")).toContain("Found 2 result(s)");
    expect(a.err.join("")).toContain("narrow by category");
    const b = io();
    await runSearch(client, "x", { quiet: true }, b.api);
    expect(b.err.join("")).toBe("");
  });

  it("maps NotFoundError to exit 2 and emits a JSON error envelope", async () => {
    const client = {
      search: vi.fn().mockRejectedValue(new NotFoundError("no paper")),
    } as unknown as ArxivClient;
    const { err, api } = io();
    const code = await runSearch(client, "x", { json: true }, api);
    expect(code).toBe(2);
    expect(JSON.parse(err.join(""))).toEqual({ error: { code: "NOT_FOUND", message: "no paper" } });
  });

  it("returns exit 1 on a usage error", async () => {
    const client = { search: vi.fn() } as unknown as ArxivClient;
    const { err, api } = io();
    const code = await runSearch(client, undefined, {}, api);
    expect(code).toBe(1);
    expect(err.join("")).toContain("query or at least one field");
    expect(client.search).not.toHaveBeenCalled();
  });
});
```

Create the stub `src/cli/commands/search.ts`:

```ts
import type { ArxivClient } from "../../core/client.js";
import type { SearchParams, SearchResult } from "../../core/types.js";

export interface SearchFlags {
  author?: string;
  category?: string;
  title?: string;
  abstract?: string;
  sort?: "relevance" | "submitted" | "updated";
  order?: "asc" | "desc";
  max?: number;
  start?: number;
  json?: boolean;
  quiet?: boolean;
  verbose?: boolean;
}

export interface SearchIo {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
}

export function buildSearchParams(_query: string | undefined, _opts: SearchFlags): SearchParams {
  return {};
}

export function formatSearchJson(_result: SearchResult): string {
  return "";
}

export function formatSearchHuman(_result: SearchResult): string {
  return "";
}

export async function runSearch(
  _client: ArxivClient,
  _query: string | undefined,
  _opts: SearchFlags,
  _io: SearchIo,
): Promise<number> {
  return 0;
}
```

Run: `npx vitest run test/cli/commands/search.test.ts` — expect FAIL (mapping `toEqual` mismatch, usage throw not raised, formatters empty).

- [ ] **Step 2: Implement `buildSearchParams`, the formatters, and `runSearch`.** Replace `src/cli/commands/search.ts` with the full implementation.

```ts
import type { ArxivClient } from "../../core/client.js";
import type { SearchParams, SearchResult } from "../../core/types.js";
import { ArxivError, exitCodeFor } from "../../core/errors.js";

export interface SearchFlags {
  author?: string;
  category?: string;
  title?: string;
  abstract?: string;
  sort?: "relevance" | "submitted" | "updated";
  order?: "asc" | "desc";
  max?: number;
  start?: number;
  json?: boolean;
  quiet?: boolean;
  verbose?: boolean;
}

export interface SearchIo {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
}

function mapSort(sort: SearchFlags["sort"]): SearchParams["sortBy"] {
  if (sort === "submitted") return "submittedDate";
  if (sort === "updated") return "lastUpdatedDate";
  return "relevance";
}

function mapOrder(order: SearchFlags["order"]): SearchParams["sortOrder"] {
  return order === "asc" ? "ascending" : "descending";
}

export function buildSearchParams(query: string | undefined, opts: SearchFlags): SearchParams {
  const params: SearchParams = {};
  if (query) params.query = query;
  if (opts.author) params.author = opts.author;
  if (opts.category) params.category = opts.category;
  if (opts.title) params.title = opts.title;
  if (opts.abstract) params.abstract = opts.abstract;
  if (opts.sort) params.sortBy = mapSort(opts.sort);
  if (opts.order) params.sortOrder = mapOrder(opts.order);
  if (opts.max !== undefined) params.maxResults = opts.max;
  if (opts.start !== undefined) params.start = opts.start;
  if (!params.query && !params.author && !params.title && !params.abstract && !params.category) {
    throw new Error(
      "provide a search query or at least one field filter (--title, --author, --abstract, --category)",
    );
  }
  return params;
}

function formatAuthors(p: SearchResult["papers"][number]): string {
  const a = p.authors;
  if (a.length === 0) return "Unknown";
  if (a.length <= 3) return a.map((x) => x.name).join(", ");
  return `${a[0].name} et al.`;
}

export function formatSearchJson(result: SearchResult): string {
  return JSON.stringify(result, null, 2);
}

export function formatSearchHuman(result: SearchResult): string {
  const lines: string[] = [];
  lines.push(`Found ${result.total} result(s) (showing ${result.start + 1}-${result.start + result.count})`);
  lines.push("");
  result.papers.forEach((p, i) => {
    lines.push(`${i + 1}. ${p.title}`);
    lines.push(`   ${p.id} | ${formatAuthors(p)} | ${p.primaryCategory} | ${p.published.slice(0, 10)}`);
  });
  return lines.join("\n") + "\n";
}

export async function runSearch(
  client: ArxivClient,
  query: string | undefined,
  opts: SearchFlags,
  io: SearchIo,
): Promise<number> {
  try {
    const params = buildSearchParams(query, opts);
    const result = await client.search(params);
    if (opts.json) {
      io.stdout(formatSearchJson(result) + "\n");
    } else {
      io.stdout(formatSearchHuman(result));
    }
    if (!opts.quiet && result.hints) {
      for (const h of result.hints) io.stderr(h + "\n");
    }
    return 0;
  } catch (err) {
    if (err instanceof ArxivError) {
      const code = exitCodeFor(err);
      if (opts.json) {
        io.stderr(JSON.stringify({ error: { code: err.code, message: err.message } }) + "\n");
      } else {
        io.stderr(`Error: ${err.message}\n`);
        if (opts.verbose && err.stack) io.stderr(err.stack + "\n");
      }
      return code;
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (opts.json) {
      io.stderr(JSON.stringify({ error: { code: "USAGE", message: msg } }) + "\n");
    } else {
      io.stderr(`Error: ${msg}\n`);
    }
    return 1;
  }
}
```

Run: `npx vitest run test/cli/commands/search.test.ts` — expect PASS.

- [ ] **Step 3: Commit the search command.**

```
git add src/cli/commands/search.ts test/cli/commands/search.test.ts
git commit -m "feat(cli): add search command handler with flag mapping and formatters"
```

---

### Task: CLI Program Bootstrap

**Files:**
- Create: `src/cli/index.ts`
- Test: `test/cli/index.test.ts`

**Interfaces:**
- Consumes: `runSearch(client, query, opts, io): Promise<number>` and `interface SearchFlags` from `src/cli/commands/search.ts`; `class ArxivClient` from `src/core/client.ts`; `ArxivConfig` from `src/core/types.ts`; `ArxivError`, `exitCodeFor` from `src/core/errors.ts`; `commander` (`Command`, `Option`, `CommanderError`).
- Produces: `type Stdio`; `interface GlobalFlags`; `interface CliDeps`; `const VERSION: string`; `function defaultClientFactory(flags: GlobalFlags): ArxivClient`; `function createProgram(deps?: CliDeps): Command`; `function run(argv?: string[], deps?: CliDeps): Promise<number>` (the first runnable artifact, imported by the bin entry).

- [ ] **Step 1: Write failing tests for the program bootstrap.** Create `test/cli/index.test.ts` covering program structure, the `search` happy path with flag capture, global-flag propagation (`--no-cache` / `--browser` / `--cache-dir`), `ArxivError` exit-code mapping, usage exit 1, and `defaultClientFactory`; create a stub `src/cli/index.ts` so imports resolve but assertions fail.

Create `test/cli/index.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createProgram,
  run,
  defaultClientFactory,
  type GlobalFlags,
} from "../../src/cli/index.js";
import { ArxivClient } from "../../src/core/client.js";
import { NotFoundError } from "../../src/core/errors.js";
import type { SearchResult } from "../../src/core/types.js";

function sink(): { buf: string[]; io: { write(s: string): boolean } } {
  const buf: string[] = [];
  return { buf, io: { write: (s: string) => { buf.push(s); return true; } } };
}

const paper = {
  id: "1706.03762",
  title: "Attention Is All You Need",
  summary: "",
  authors: [],
  categories: ["cs.CL"],
  primaryCategory: "cs.CL",
  published: "2017-06-12T00:00:00Z",
  updated: "2017-06-12T00:00:00Z",
  links: { abs: "https://arxiv.org/abs/1706.03762", pdf: "https://arxiv.org/pdf/1706.03762" },
};
const result: SearchResult = { total: 1, start: 0, count: 1, papers: [paper] };

describe("cli index", () => {
  beforeEach(() => {
    process.exitCode = undefined;
  });

  it("creates a program named arxiv with a search command", () => {
    const program = createProgram();
    expect(program.name()).toBe("arxiv");
    expect(program.commands.map((c) => c.name())).toContain("search");
  });

  it("runs search with --json, maps flags + params, prints JSON", async () => {
    const captured: { flags?: GlobalFlags } = {};
    const mockClient = { search: vi.fn().mockResolvedValue(result) } as unknown as ArxivClient;
    const createClient = (flags: GlobalFlags) => {
      captured.flags = flags;
      return mockClient;
    };
    const out = sink();
    const err = sink();
    const code = await run(["search", "transformer", "--json"], {
      createClient,
      stdout: out.io,
      stderr: err.io,
    });
    expect(code).toBe(0);
    expect(captured.flags?.json).toBe(true);
    expect(mockClient.search).toHaveBeenCalledWith({
      query: "transformer",
      sortBy: "relevance",
      sortOrder: "descending",
      maxResults: 25,
      start: 0,
    });
    expect(JSON.parse(out.buf.join(""))).toEqual(result);
  });

  it("propagates --no-cache placed before the subcommand", async () => {
    const captured: { flags?: GlobalFlags } = {};
    const mockClient = { search: vi.fn().mockResolvedValue(result) } as unknown as ArxivClient;
    const createClient = (flags: GlobalFlags) => {
      captured.flags = flags;
      return mockClient;
    };
    await run(["--no-cache", "search", "x"], { createClient, stdout: sink().io, stderr: sink().io });
    expect(captured.flags?.noCache).toBe(true);
  });

  it("propagates --browser and --cache-dir", async () => {
    const captured: { flags?: GlobalFlags } = {};
    const mockClient = { search: vi.fn().mockResolvedValue(result) } as unknown as ArxivClient;
    const createClient = (flags: GlobalFlags) => {
      captured.flags = flags;
      return mockClient;
    };
    await run(["--browser", "--cache-dir", "/tmp/c", "search", "x"], {
      createClient,
      stdout: sink().io,
      stderr: sink().io,
    });
    expect(captured.flags?.browser).toBe(true);
    expect(captured.flags?.cacheDir).toBe("/tmp/c");
  });

  it("maps ArxivError to its exit code with a JSON error envelope", async () => {
    const mockClient = {
      search: vi.fn().mockRejectedValue(new NotFoundError("no paper")),
    } as unknown as ArxivClient;
    const createClient = () => mockClient;
    const err = sink();
    const code = await run(["search", "x", "--json"], { createClient, stdout: sink().io, stderr: err.io });
    expect(code).toBe(2);
    expect(JSON.parse(err.buf.join(""))).toEqual({ error: { code: "NOT_FOUND", message: "no paper" } });
  });

  it("returns exit 1 on a usage error (no query and no field)", async () => {
    const mockClient = { search: vi.fn() } as unknown as ArxivClient;
    const createClient = () => mockClient;
    const err = sink();
    const code = await run(["search"], { createClient, stdout: sink().io, stderr: err.io });
    expect(code).toBe(1);
    expect(err.buf.join("")).toContain("query or at least one field");
    expect(mockClient.search).not.toHaveBeenCalled();
  });

  it("defaultClientFactory builds an ArxivClient with overrides", () => {
    const c = defaultClientFactory({ noCache: true, cacheDir: "/tmp/c", browser: true });
    expect(c).toBeInstanceOf(ArxivClient);
  });
});
```

Create the stub `src/cli/index.ts`:

```ts
#!/usr/bin/env node
import { Command } from "commander";
import { ArxivClient } from "../core/client.js";
import type { ArxivConfig } from "../core/types.js";

export const VERSION = "0.1.0";

export type Stdio = { write(chunk: string): boolean };

export interface GlobalFlags {
  noCache?: boolean;
  cacheDir?: string;
  browser?: boolean;
  json?: boolean;
  quiet?: boolean;
  verbose?: boolean;
}

export interface CliDeps {
  createClient?: (flags: GlobalFlags) => ArxivClient;
  stdout?: Stdio;
  stderr?: Stdio;
  exit?: (code: number) => void;
}

export function defaultClientFactory(_flags: GlobalFlags): ArxivClient {
  return new ArxivClient({});
}

export function createProgram(_deps: CliDeps = {}): Command {
  return new Command();
}

export async function run(_argv: string[] = process.argv.slice(2), _deps: CliDeps = {}): Promise<number> {
  return 0;
}

void (null as unknown as ArxivConfig);
```

Run: `npx vitest run test/cli/index.test.ts` — expect FAIL (program has no `search` command, `run` returns 0 regardless, flags not propagated).

- [ ] **Step 2: Implement `createProgram`, `run`, and `defaultClientFactory`.** Replace `src/cli/index.ts` with the full bootstrap. Global flags are added to both the root program and the `search` subcommand so they may appear before or after the subcommand; `mergeGlobal` ORs the `--no-cache`/`--browser` intent and prefers the subcommand placement for `--cache-dir`/`--json`/`--quiet`/`--verbose`. `run` captures the exit code through an injected sink (defaulting to `process.exitCode`) and uses `program.exitOverride()` so commander errors throw instead of calling `process.exit`.

```ts
#!/usr/bin/env node
import { Command, CommanderError, Option } from "commander";
import { ArxivClient } from "../core/client.js";
import type { ArxivConfig } from "../core/types.js";
import { runSearch } from "./commands/search.js";
import type { SearchFlags } from "./commands/search.js";

export const VERSION = "0.1.0";

export type Stdio = { write(chunk: string): boolean };

export interface GlobalFlags {
  noCache?: boolean;
  cacheDir?: string;
  browser?: boolean;
  json?: boolean;
  quiet?: boolean;
  verbose?: boolean;
}

export interface CliDeps {
  createClient?: (flags: GlobalFlags) => ArxivClient;
  stdout?: Stdio;
  stderr?: Stdio;
  exit?: (code: number) => void;
}

export function defaultClientFactory(flags: GlobalFlags): ArxivClient {
  const overrides: Partial<ArxivConfig> = {};
  if (flags.noCache) overrides.noCache = true;
  if (flags.cacheDir) overrides.cacheDir = flags.cacheDir;
  if (flags.browser) overrides.browserFallback = true;
  return new ArxivClient(overrides);
}

type RawOpts = Record<string, unknown>;

function mergeGlobal(a: RawOpts, b: RawOpts): GlobalFlags {
  return {
    noCache: a.cache === false || b.cache === false ? true : undefined,
    browser: a.browser === true || b.browser === true ? true : undefined,
    cacheDir: (b.cacheDir as string | undefined) ?? (a.cacheDir as string | undefined),
    json: (b.json as boolean | undefined) ?? (a.json as boolean | undefined),
    quiet: (b.quiet as boolean | undefined) ?? (a.quiet as boolean | undefined),
    verbose: (b.verbose as boolean | undefined) ?? (a.verbose as boolean | undefined),
  };
}

function addCommonOptions(cmd: Command): void {
  cmd.option("--json", "Output JSON (scripting-friendly)");
  cmd.option("--no-cache", "Bypass the cache for this invocation");
  cmd.option("--cache-dir <dir>", "Cache directory");
  cmd.option("--browser", "Enable the browser fallback");
  cmd.option("--quiet", "Suppress non-essential stderr output (hints)");
  cmd.option("--verbose", "Print error stacks on failure");
}

function commanderExitCode(e: unknown): number {
  if (e instanceof CommanderError) return e.exitCode;
  return 1;
}

export function createProgram(deps: CliDeps = {}): Command {
  const createClient = deps.createClient ?? defaultClientFactory;
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const exit = deps.exit ?? ((c: number) => {
    process.exitCode = c;
  });
  const io = {
    stdout: (s: string) => stdout.write(s),
    stderr: (s: string) => stderr.write(s),
  };

  const program = new Command();
  program
    .name("arxiv")
    .description("Search, read, and download arXiv papers")
    .version(VERSION);
  addCommonOptions(program);
  program.exitOverride();

  const search = program.command("search [query]");
  search.description("Search arXiv papers");
  addCommonOptions(search);
  search.option("--author <name>", "Filter by author");
  search.option("--category <cat>", "Filter by category");
  search.option("--title <text>", "Filter by title");
  search.option("--abstract <text>", "Filter by abstract");
  search.addOption(
    new Option("--sort <field>", "Sort by").default("relevance").choices(["relevance", "submitted", "updated"]),
  );
  search.addOption(
    new Option("--order <dir>", "Sort order").default("descending").choices(["asc", "desc"]),
  );
  search.option("--max <n>", "Maximum results", (v: string) => Number(v), 25);
  search.option("--start <n>", "Start offset", (v: string) => Number(v), 0);

  search.action(async function (query: string | undefined, opts: RawOpts) {
    const globalFlags = mergeGlobal(program.opts(), opts);
    const client = createClient(globalFlags);
    const flags: SearchFlags = {
      author: opts.author as string | undefined,
      category: opts.category as string | undefined,
      title: opts.title as string | undefined,
      abstract: opts.abstract as string | undefined,
      sort: opts.sort as SearchFlags["sort"],
      order: opts.order as SearchFlags["order"],
      max: opts.max as number | undefined,
      start: opts.start as number | undefined,
      json: globalFlags.json,
      quiet: globalFlags.quiet,
      verbose: globalFlags.verbose,
    };
    const code = await runSearch(client, query, flags, io);
    exit(code);
  });

  return program;
}

export async function run(argv: string[] = process.argv.slice(2), deps: CliDeps = {}): Promise<number> {
  let code = 0;
  const exit = (c: number) => {
    code = c;
    if (deps.exit) deps.exit(c);
    else process.exitCode = c;
  };
  const program = createProgram({ ...deps, exit });
  try {
    await program.parseAsync(argv, { from: "user" });
  } catch (e) {
    code = commanderExitCode(e);
    if (deps.exit) deps.exit(code);
    else process.exitCode = code;
  }
  return code;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run().then((c) => {
    if (c !== 0) process.exit(c);
  });
}
```

Run: `npx vitest run test/cli/index.test.ts` — expect PASS.

- [ ] **Step 3: Run the whole CLI suite together.**

Run: `npx vitest run test/cli/` — expect PASS (both `search.test.ts` and `index.test.ts`).

- [ ] **Step 4: Commit the CLI bootstrap.**

```
git add src/cli/index.ts test/cli/index.test.ts
git commit -m "feat(cli): bootstrap arxiv commander program with global flags and search command"
```
---

## Phase 6: Read full text

<!-- Phase: Read full text -->

### Task A: Shared HTML→Markdown converter (src/core/parse/html-common.ts)

**Files:**
- Source: `/Users/aildan/arxiv/src/core/parse/html-common.ts` (Create)
- Test: `/Users/aildan/arxiv/test/core/parse/html-common.test.ts` (Create)
- Commit: `src/core/parse/html-common.ts`, `test/core/parse/html-common.test.ts`

**Interfaces:**
- Consumes: `turndown` (`import TurndownService from "turndown"`); `turndown-plugin-gfm` (CJS — `import gfmPkg from "turndown-plugin-gfm"; const { gfm } = gfmPkg;`).
- Produces:
  - `export function makeTurndown(): TurndownService`
  - `export function htmlFragmentToMarkdown(html: string, td?: TurndownService): string`

**Notes for the implementer:** This module is the **single** HTML→Markdown converter shared by both schema branches (native `ltx_*` and ar5iv). It never selects elements by schema — it receives an HTML **fragment** (the inner HTML of one section) and returns Markdown. Schema-specific selection lives in `html-native.ts` / `html-ar5iv.ts` (Tasks B/C).

Configuration of the `TurndownService`:
- GFM tables/strikethrough via the plugin: `td.use(gfm)`. The plugin is **CJS**; the default import is the namespace and `gfm` is a property of it (`const { gfm } = gfmPkg`). Importing it wrong is the regression the §15 smoke test guards.
- **Math survives as LaTeX.** LaTeXML/MathJax emit a `<math>` MathML element that carries the original TeX in an `<annotation encoding="application/x-tex">` child (inside `<semantics>`). Add a Turndown rule keyed on `math` that, given the node, reads that annotation's text and emits `$…$` for inline math (`<math display="inline">` or no `display`) and `$$…$$` for `<math display="block">`. If no TeX annotation is present, fall back to the element's text content. Returning the delimited TeX means the surrounding `<semantics>`/`<annotation>` subtree is consumed by this rule (Turndown does not descend into a node a rule fully replaces), so raw MathML never leaks.
- **Footnotes / superscripts.** Keep `<sup>` content inline (Turndown's default would drop the tag's semantics); add a rule that renders `<sup>` as its inner Markdown wrapped so the marker survives (e.g. `^{…}` is noisy — emit the inner text in square brackets only when it is a footnote/cite link, otherwise keep the plain superscript text). Concretely: a `sup` whose only child is an `<a>` is a footnote/citation marker → emit `[<text>]`; a bare `sup` (e.g. `x²` exponents already unicode, or `10<sup>3</sup>`) → emit `^<text>`.
- **Bibliography.** `section.ltx_bibliography` is handled at selection time (Task B keeps it as a normal section); within `html-common` no special rule is needed beyond the `<sup>`/cite handling, but ensure `<cite>` is unwrapped to its text (`addRule` keyed on `cite` returning the inner Markdown) so reference markers read cleanly.

`htmlFragmentToMarkdown(html, td?)` builds a Turndown service once if `td` is omitted (callers that convert many sections should construct one via `makeTurndown()` and pass it in to avoid rebuilding). It returns `td.turndown(html).trim()`.

- [ ] **Step 1: Write the failing converter test (incl. the §15 gfm ESM smoke test).** Create `test/core/parse/html-common.test.ts`. Complete file:

```ts
import { describe, it, expect } from "vitest";
import gfmPkg from "turndown-plugin-gfm";
import TurndownService from "turndown";
import {
  makeTurndown,
  htmlFragmentToMarkdown,
} from "../../../src/core/parse/html-common.js";

describe("turndown-plugin-gfm ESM interop (smoke test)", () => {
  it("exposes gfm as a callable plugin off the CJS default import", () => {
    // This is the regression guard (§15): the plugin is CJS; the default import
    // is the namespace and `gfm` is a property. `use()` must accept it.
    const { gfm } = gfmPkg;
    expect(typeof gfm).toBe("function");
    const td = new TurndownService();
    expect(() => td.use(gfm)).not.toThrow();
  });
});

describe("htmlFragmentToMarkdown", () => {
  it("converts a GFM table via the plugin", () => {
    const html =
      "<table><thead><tr><th>A</th><th>B</th></tr></thead>" +
      "<tbody><tr><td>1</td><td>2</td></tr></tbody></table>";
    const md = htmlFragmentToMarkdown(html);
    expect(md).toContain("| A | B |");
    expect(md).toContain("| 1 | 2 |");
    expect(md).toMatch(/\| --- \| --- \|/);
  });

  it("preserves inline math as $…$ from the TeX annotation", () => {
    const html =
      '<p>Energy <math display="inline"><semantics>' +
      '<mrow><mi>E</mi><mo>=</mo><mi>m</mi><msup><mi>c</mi><mn>2</mn></msup></mrow>' +
      '<annotation encoding="application/x-tex">E = mc^2</annotation>' +
      "</semantics></math> follows.</p>";
    const md = htmlFragmentToMarkdown(html);
    expect(md).toContain("$E = mc^2$");
    expect(md).not.toContain("<math");
    expect(md).not.toContain("annotation");
  });

  it("preserves display math as $$…$$ from the TeX annotation", () => {
    const html =
      '<math display="block"><semantics><mrow><mi>x</mi></mrow>' +
      '<annotation encoding="application/x-tex">\\int_0^1 x\\,dx</annotation>' +
      "</semantics></math>";
    const md = htmlFragmentToMarkdown(html);
    expect(md).toContain("$$\\int_0^1 x\\,dx$$");
  });

  it("falls back to math text content when no TeX annotation is present", () => {
    const html = '<math display="inline"><mi>y</mi></math>';
    const md = htmlFragmentToMarkdown(html);
    expect(md).toContain("$y$");
  });

  it("renders a footnote/citation sup-link as a bracketed marker", () => {
    const html = '<p>claim<sup id="fnref1"><a href="#fn1">3</a></sup>.</p>';
    const md = htmlFragmentToMarkdown(html);
    expect(md).toContain("claim[3]");
  });

  it("renders a bare superscript with a caret marker", () => {
    const html = "<p>10<sup>3</sup> joules</p>";
    const md = htmlFragmentToMarkdown(html);
    expect(md).toContain("10^3");
  });

  it("unwraps <cite> to its inner text", () => {
    const html = "<p>see <cite>Smith 2020</cite></p>";
    const md = htmlFragmentToMarkdown(html);
    expect(md).toContain("see Smith 2020");
    expect(md).not.toContain("<cite");
  });

  it("reuses an injected TurndownService instance", () => {
    const td = makeTurndown();
    const a = htmlFragmentToMarkdown("<p>one</p>", td);
    const b = htmlFragmentToMarkdown("<p>two</p>", td);
    expect(a).toBe("one");
    expect(b).toBe("two");
  });
});
```

- [ ] **Step 2: Run the test, expect FAIL.** Run: `npx vitest run test/core/parse/html-common.test.ts`. Expected: FAIL — `Cannot find module '../../../src/core/parse/html-common.js'`.

- [ ] **Step 3: Implement src/core/parse/html-common.ts.** Create the file. Complete contents:

```ts
import TurndownService from "turndown";
import gfmPkg from "turndown-plugin-gfm";

// turndown-plugin-gfm ships as CommonJS: the default import is the namespace
// object and `gfm` is a property of it. Destructuring here is the correct
// ESM interop and is asserted by the §15 smoke test.
const { gfm } = gfmPkg;

/** Read the LaTeX source a LaTeXML/MathJax <math> node carries, if any. */
function texAnnotation(node: HTMLElement): string | null {
  const ann = node.querySelector?.('annotation[encoding="application/x-tex"]');
  const tex = ann?.textContent?.trim();
  return tex && tex.length > 0 ? tex : null;
}

/**
 * Build a TurndownService configured for arXiv HTML fragments:
 * GFM tables/strikethrough, math preserved as `$…$`/`$$…$$`, footnote/cite
 * markers kept readable. Construct once and reuse across many sections.
 */
export function makeTurndown(): TurndownService {
  const td = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
    emDelimiter: "*",
  });

  td.use(gfm);

  // Math: emit the original TeX, inline vs. display by the `display` attribute.
  // Returning a string consumes the whole <math> subtree (incl. <semantics>/
  // <annotation>), so raw MathML never leaks into the Markdown.
  td.addRule("math", {
    filter: (node) => node.nodeName.toLowerCase() === "math",
    replacement: (_content, node) => {
      const el = node as unknown as HTMLElement;
      const tex = texAnnotation(el) ?? el.textContent?.trim() ?? "";
      if (tex.length === 0) return "";
      const display = el.getAttribute?.("display");
      return display === "block" ? `$$${tex}$$` : `$${tex}$`;
    },
  });

  // Superscripts: a sup whose sole child is an <a> is a footnote/citation
  // marker -> `[text]`; any other sup -> `^text`.
  td.addRule("sup", {
    filter: (node) => node.nodeName.toLowerCase() === "sup",
    replacement: (content, node) => {
      const el = node as unknown as HTMLElement;
      const text = (el.textContent ?? content).trim();
      if (text.length === 0) return "";
      const onlyChild =
        el.children?.length === 1 &&
        el.children[0].nodeName.toLowerCase() === "a";
      return onlyChild ? `[${text}]` : `^${text}`;
    },
  });

  // <cite> -> its inner text (reference markers read cleanly).
  td.addRule("cite", {
    filter: (node) => node.nodeName.toLowerCase() === "cite",
    replacement: (content) => content,
  });

  return td;
}

/**
 * Convert an HTML fragment (the inner HTML of one section) to Markdown.
 * Pass a shared `td` from makeTurndown() when converting many fragments.
 */
export function htmlFragmentToMarkdown(
  html: string,
  td?: TurndownService,
): string {
  const service = td ?? makeTurndown();
  return service.turndown(html).trim();
}
```

- [ ] **Step 4: Run the test, expect PASS.** Run: `npx vitest run test/core/parse/html-common.test.ts`. Expected: PASS — gfm smoke test green; table, inline/display math, math-text fallback, footnote/cite markers all green. If the `<sup>`/`<cite>` rules interact with Turndown's `children` access under your DOM (Turndown runs on its own DOM via jsdom-free string parsing internally), prefer `el.childNodes`/`el.textContent`, which Turndown's node objects expose; do not switch the surrounding selection to a different DOM — `html-common` only ever sees Turndown's node objects.

- [ ] **Step 5: Run typecheck.** Run: `npx tsc --noEmit`. Expected: no errors originating in `src/core/parse/html-common.ts` or its test. (Other not-yet-created files are out of scope for this task.)

- [ ] **Step 6: Commit.** Run:
```
git add src/core/parse/html-common.ts test/core/parse/html-common.test.ts && git commit -m "feat(core): add shared HTML→Markdown converter with math/footnote/table rules

- makeTurndown() configures turndown + turndown-plugin-gfm (CJS-interop via
  default import then destructure { gfm }); §15 ESM smoke test guards the regression.
- math rule emits original TeX as \$…\$ / \$\$…\$\$ from the x-tex annotation,
  consuming the MathML subtree; sup rule keeps footnote/citation + exponent markers;
  cite unwrapped to text.
- htmlFragmentToMarkdown converts one section's inner HTML; accepts a shared service.
"
```

---

### Task B: Parse native LaTeXML HTML (src/core/parse/html-native.ts)

**Files:**
- Source: `/Users/aildan/arxiv/src/core/parse/html-native.ts` (Create)
- Fixture: `/Users/aildan/arxiv/test/fixtures/native.html` (Create)
- Test: `/Users/aildan/arxiv/test/core/parse/html-native.test.ts` (Create)
- Commit: `src/core/parse/html-native.ts`, `test/fixtures/native.html`, `test/core/parse/html-native.test.ts`

**Interfaces:**
- Consumes: `linkedom` (`import { parseHTML } from "linkedom"`); `Section` from `src/core/types.ts`; `htmlFragmentToMarkdown`, `makeTurndown` from `./html-common.js`.
- Produces: `export function parseNativeHtml(html: string): { title: string; abstract?: string; sections: Section[] }`

**Notes for the implementer:** Native HTML is the LaTeXML `ltx_*` schema (spec §5.2):
- Title: `h1.ltx_title_document` (text).
- Abstract: `section.ltx_abstract`; its heading is `h6.ltx_title_abstract` (strip that heading, convert the remaining body to Markdown for the `abstract` string).
- Sections: every `section.ltx_section` — `id` from the element's `id` attribute (`S1`), title from `h2.ltx_title_section`, `level: 1`. Subsections: `section.ltx_subsection` — `id` (`S1.SS1`), title `h3.ltx_title_subsection`, `level: 2`.
- Flatten the document into an **ordered** `Section[]` by walking sections then their subsections in document order. Each `Section.content` is the **inner HTML of that block with the heading element and any nested deeper-level `<section>` removed**, converted via `html-common`. (Removing nested subsections from a parent section's content prevents duplicating subsection text — subsections appear as their own flattened entries.)
- Build one `TurndownService` via `makeTurndown()` and pass it to every `htmlFragmentToMarkdown` call.
- The bibliography is `section#bib.ltx_bibliography`; treat it as a normal section (it usually has `ltx_section`-like structure or its own heading — select its heading via `h2.ltx_title_section, h2.ltx_title_bibliography` defensively).
- **Empty/zero-section result is the fallback signal:** if there are zero `section.ltx_section` blocks (e.g. an unexpected page), return `{ title, abstract, sections: [] }` and let the caller (Task E) fall through to ar5iv/PDF. Do not throw on empty.

- [ ] **Step 1: Write the native HTML fixture.** Create `test/fixtures/native.html`. Complete file:

```html
<!DOCTYPE html>
<html lang="en">
  <head><title>Sample Native</title></head>
  <body>
    <article class="ltx_document">
      <h1 class="ltx_title ltx_title_document">A Native LaTeXML Paper</h1>
      <div class="ltx_authors"><span class="ltx_personname">Ada Lovelace</span></div>
      <section class="ltx_abstract">
        <h6 class="ltx_title ltx_title_abstract">Abstract</h6>
        <p class="ltx_p">We study a thing and show <math display="inline"><semantics><mrow><mi>x</mi></mrow><annotation encoding="application/x-tex">x &gt; 0</annotation></semantics></math>.</p>
      </section>
      <section id="S1" class="ltx_section">
        <h2 class="ltx_title ltx_title_section">Introduction</h2>
        <p class="ltx_p">The mass-energy relation <math display="inline"><semantics><mrow><mi>E</mi><mo>=</mo><mi>m</mi><msup><mi>c</mi><mn>2</mn></msup></mrow><annotation encoding="application/x-tex">E = mc^2</annotation></semantics></math> holds.<sup id="fnref1"><a href="#fn1">1</a></sup></p>
        <section id="S1.SS1" class="ltx_subsection">
          <h3 class="ltx_title ltx_title_subsection">Background</h3>
          <p class="ltx_p">Prior work in <cite>Smith 2019</cite> is relevant.</p>
        </section>
      </section>
      <section id="S2" class="ltx_section">
        <h2 class="ltx_title ltx_title_section">Methods</h2>
        <table class="ltx_tabular">
          <thead><tr><th>Param</th><th>Value</th></tr></thead>
          <tbody><tr><td>lr</td><td>0.01</td></tr></tbody>
        </table>
      </section>
    </article>
  </body>
</html>
```

- [ ] **Step 2: Write the failing native-parse test.** Create `test/core/parse/html-native.test.ts`. Complete file:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { parseNativeHtml } from "../../../src/core/parse/html-native.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): string =>
  readFileSync(join(here, "..", "..", "fixtures", name), "utf8");

describe("parseNativeHtml", () => {
  let result: ReturnType<typeof parseNativeHtml>;
  beforeAll(() => {
    result = parseNativeHtml(fixture("native.html"));
  });

  it("extracts the document title", () => {
    expect(result.title).toBe("A Native LaTeXML Paper");
  });

  it("extracts the abstract with math preserved and heading stripped", () => {
    expect(result.abstract).toBeDefined();
    expect(result.abstract).toContain("$x > 0$");
    expect(result.abstract).not.toContain("Abstract");
  });

  it("flattens sections and subsections in document order with ids and levels", () => {
    const ids = result.sections.map((s) => s.id);
    expect(ids).toEqual(["S1", "S1.SS1", "S2"]);
    const titles = result.sections.map((s) => s.title);
    expect(titles).toEqual(["Introduction", "Background", "Methods"]);
    const levels = result.sections.map((s) => s.level);
    expect(levels).toEqual([1, 2, 1]);
  });

  it("does not duplicate subsection text inside its parent section content", () => {
    const intro = result.sections.find((s) => s.id === "S1")!;
    expect(intro.content).toContain("$E = mc^2$");
    expect(intro.content).not.toContain("Prior work"); // lives in S1.SS1 only
  });

  it("preserves the footnote marker and citation in content", () => {
    const intro = result.sections.find((s) => s.id === "S1")!;
    expect(intro.content).toContain("[1]");
    const bg = result.sections.find((s) => s.id === "S1.SS1")!;
    expect(bg.content).toContain("Smith 2019");
  });

  it("converts a GFM table inside a section", () => {
    const methods = result.sections.find((s) => s.id === "S2")!;
    expect(methods.content).toContain("| Param | Value |");
    expect(methods.content).toContain("| lr | 0.01 |");
  });
});
```

- [ ] **Step 3: Run the test, expect FAIL.** Run: `npx vitest run test/core/parse/html-native.test.ts`. Expected: FAIL — `Cannot find module '../../../src/core/parse/html-native.js'`.

- [ ] **Step 4: Implement src/core/parse/html-native.ts.** Create the file. Complete contents:

```ts
import { parseHTML } from "linkedom";
import type { Section } from "../types.js";
import { htmlFragmentToMarkdown, makeTurndown } from "./html-common.js";

interface NativeDoc {
  title: string;
  abstract?: string;
  sections: Section[];
}

/**
 * Convert a section element to Markdown after removing its own heading and any
 * nested deeper-level <section> blocks (those are flattened separately).
 */
function sectionContent(
  el: Element,
  td: ReturnType<typeof makeTurndown>,
): string {
  const clone = el.cloneNode(true) as Element;
  // Drop the heading (title is captured separately).
  clone
    .querySelectorAll(
      "h1.ltx_title_section, h2.ltx_title_section, h3.ltx_title_subsection, h2.ltx_title_bibliography",
    )
    .forEach((h) => h.remove());
  // Drop nested sections/subsections so their text isn't duplicated here.
  clone
    .querySelectorAll("section.ltx_subsection, section.ltx_subsubsection")
    .forEach((s) => s.remove());
  return htmlFragmentToMarkdown(clone.innerHTML, td);
}

export function parseNativeHtml(html: string): NativeDoc {
  const { document } = parseHTML(html);
  const td = makeTurndown();

  const title =
    document
      .querySelector("h1.ltx_title_document")
      ?.textContent?.trim() ?? "";

  let abstract: string | undefined;
  const absEl = document.querySelector("section.ltx_abstract");
  if (absEl) {
    const clone = absEl.cloneNode(true) as Element;
    clone.querySelector("h6.ltx_title_abstract")?.remove();
    const md = htmlFragmentToMarkdown(clone.innerHTML, td);
    abstract = md.length > 0 ? md : undefined;
  }

  const sections: Section[] = [];
  const topSections = document.querySelectorAll("section.ltx_section");
  for (const sec of Array.from(topSections)) {
    const id = sec.getAttribute("id") ?? undefined;
    const heading =
      sec.querySelector("h2.ltx_title_section, h2.ltx_title_bibliography") ??
      sec.querySelector("h1.ltx_title_section");
    const sTitle = heading?.textContent?.trim() ?? "";
    sections.push({
      id,
      title: sTitle,
      level: 1,
      content: sectionContent(sec, td),
    });
    // Flatten this section's direct subsections, in document order.
    const subs = sec.querySelectorAll("section.ltx_subsection");
    for (const sub of Array.from(subs)) {
      const subId = sub.getAttribute("id") ?? undefined;
      const subHeading = sub.querySelector("h3.ltx_title_subsection");
      sections.push({
        id: subId,
        title: subHeading?.textContent?.trim() ?? "",
        level: 2,
        content: sectionContent(sub, td),
      });
    }
  }

  return { title, abstract, sections };
}
```

- [ ] **Step 5: Run the test, expect PASS.** Run: `npx vitest run test/core/parse/html-native.test.ts`. Expected: PASS — title, abstract (heading stripped, math kept), flattened section/subsection ids+titles+levels in order, no subsection-text duplication, footnote/cite, and GFM table all green.

- [ ] **Step 6: Run typecheck.** Run: `npx tsc --noEmit`. Expected: no errors originating in this task's files.

- [ ] **Step 7: Commit.** Run:
```
git add src/core/parse/html-native.ts test/fixtures/native.html test/core/parse/html-native.test.ts && git commit -m "feat(core): parse native LaTeXML (ltx_*) HTML into ordered sections

- title h1.ltx_title_document; abstract section.ltx_abstract (heading stripped);
  sections section.ltx_section (h2, id S1); subsections section.ltx_subsection (h3, id S1.SS1).
- flatten to ordered Section[]; per-section content removes its heading + nested
  subsections (no duplication) and is converted via html-common (shared turndown).
- zero sections => empty result (caller's fallback signal), never throws.
- fixture exercises math, footnote, cite, and a GFM table.
"
```

---

### Task C: Parse ar5iv HTML (src/core/parse/html-ar5iv.ts)

**Files:**
- Source: `/Users/aildan/arxiv/src/core/parse/html-ar5iv.ts` (Create)
- Fixture: `/Users/aildan/arxiv/test/fixtures/ar5iv.html` (Create)
- Test: `/Users/aildan/arxiv/test/core/parse/html-ar5iv.test.ts` (Create)
- Commit: `src/core/parse/html-ar5iv.ts`, `test/fixtures/ar5iv.html`, `test/core/parse/html-ar5iv.test.ts`

**Interfaces:**
- Consumes: `linkedom` (`parseHTML`); `Section` from `src/core/types.ts`; `htmlFragmentToMarkdown`, `makeTurndown` from `./html-common.js`.
- Produces: `export function parseAr5ivHtml(html: string): { title: string; abstract?: string; sections: Section[] }`

**Notes for the implementer:** **A single selector set cannot parse both schemas.** ar5iv is the older Labs schema (spec §5.2): the title is `h1.title.mathjax` (class list `title mathjax`), and section headings are **bare `h1`/`h2`** rather than `h2.ltx_title_section`. Because ar5iv still descends from a LaTeXML lineage it often *also* carries `ltx_*` markup, but the contract pins the ar5iv-distinct selectors — match on `h1.ltx_title_document, h1.title.mathjax` for the title (try ar5iv-specific first), and segment sections by the older structure. This file is a **separate branch** from `html-native.ts`; both feed the shared `html-common.ts` converter (do not try to unify them).

Section segmentation for ar5iv:
- Title: `h1.title.mathjax` (fallback `h1.ltx_title_document`).
- Abstract: `div.abstract, section.ltx_abstract` (heading may be `h6.ltx_title_abstract` or a `<div class="abstract-title">`/leading `Abstract` run — strip a leading heading element if present).
- Sections: prefer `section.ltx_section` if present (ar5iv frequently keeps them); otherwise fall back to splitting on bare `h2` headings within the body. Use `id` attribute when present. Subsections: `section.ltx_subsection` or bare `h3`. Keep `level` 1 for sections, 2 for subsections. Reuse the same "clone, strip heading + nested subsections, convert" approach as Task B.
- Zero sections → empty result (fallback signal), never throw.

- [ ] **Step 1: Write the ar5iv fixture (older schema).** Create `test/fixtures/ar5iv.html`. Complete file:

```html
<!DOCTYPE html>
<html lang="en">
  <head><title>Sample ar5iv</title></head>
  <body>
    <div class="ltx_page_content">
      <h1 class="ltx_title title mathjax">An ar5iv Historical Paper</h1>
      <div class="abstract">
        <h6 class="abstract-title">Abstract</h6>
        <p>We revisit a classic result and recover <math display="inline"><semantics><mrow><mi>a</mi></mrow><annotation encoding="application/x-tex">a \le b</annotation></semantics></math>.</p>
      </div>
      <section id="S1" class="ltx_section">
        <h2 class="ltx_title">Overview</h2>
        <p>A bare-schema overview with a marker.<sup><a href="#bib1">2</a></sup></p>
        <section id="S1.SS1" class="ltx_subsection">
          <h3 class="ltx_title">Details</h3>
          <p>Details cite <cite>Jones 2001</cite>.</p>
        </section>
      </section>
      <section id="S2" class="ltx_section">
        <h2 class="ltx_title">Results</h2>
        <p>The result is positive.</p>
      </section>
    </div>
  </body>
</html>
```

- [ ] **Step 2: Write the failing ar5iv-parse test.** Create `test/core/parse/html-ar5iv.test.ts`. Complete file:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseAr5ivHtml } from "../../../src/core/parse/html-ar5iv.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): string =>
  readFileSync(join(here, "..", "..", "fixtures", name), "utf8");

describe("parseAr5ivHtml", () => {
  let result: ReturnType<typeof parseAr5ivHtml>;
  beforeAll(() => {
    result = parseAr5ivHtml(fixture("ar5iv.html"));
  });

  it("extracts the title from h1.title.mathjax", () => {
    expect(result.title).toBe("An ar5iv Historical Paper");
  });

  it("extracts the abstract with math preserved and heading stripped", () => {
    expect(result.abstract).toBeDefined();
    expect(result.abstract).toContain("$a \\le b$");
    expect(result.abstract).not.toContain("Abstract");
  });

  it("flattens sections and subsections in document order", () => {
    expect(result.sections.map((s) => s.id)).toEqual(["S1", "S1.SS1", "S2"]);
    expect(result.sections.map((s) => s.title)).toEqual([
      "Overview",
      "Details",
      "Results",
    ]);
    expect(result.sections.map((s) => s.level)).toEqual([1, 2, 1]);
  });

  it("preserves the footnote marker and citation", () => {
    const overview = result.sections.find((s) => s.id === "S1")!;
    expect(overview.content).toContain("[2]");
    expect(overview.content).not.toContain("Details cite"); // in S1.SS1 only
    const details = result.sections.find((s) => s.id === "S1.SS1")!;
    expect(details.content).toContain("Jones 2001");
  });
});
```

- [ ] **Step 3: Run the test, expect FAIL.** Run: `npx vitest run test/core/parse/html-ar5iv.test.ts`. Expected: FAIL — `Cannot find module '../../../src/core/parse/html-ar5iv.js'`.

- [ ] **Step 4: Implement src/core/parse/html-ar5iv.ts.** Create the file. Complete contents:

```ts
import { parseHTML } from "linkedom";
import type { Section } from "../types.js";
import { htmlFragmentToMarkdown, makeTurndown } from "./html-common.js";

interface Ar5ivDoc {
  title: string;
  abstract?: string;
  sections: Section[];
}

function sectionContent(
  el: Element,
  td: ReturnType<typeof makeTurndown>,
): string {
  const clone = el.cloneNode(true) as Element;
  // Strip the section's own heading (bare or ltx_*) — only the first heading.
  const heading = clone.querySelector("h1, h2, h3, h6");
  heading?.remove();
  clone
    .querySelectorAll("section.ltx_subsection, section.ltx_subsubsection")
    .forEach((s) => s.remove());
  return htmlFragmentToMarkdown(clone.innerHTML, td);
}

export function parseAr5ivHtml(html: string): Ar5ivDoc {
  const { document } = parseHTML(html);
  const td = makeTurndown();

  // ar5iv-distinct title first, then the LaTeXML form as a defensive fallback.
  const title =
    document
      .querySelector("h1.title.mathjax, h1.ltx_title_document")
      ?.textContent?.trim() ?? "";

  let abstract: string | undefined;
  const absEl = document.querySelector("div.abstract, section.ltx_abstract");
  if (absEl) {
    const clone = absEl.cloneNode(true) as Element;
    clone.querySelector("h6.ltx_title_abstract, .abstract-title, h6")?.remove();
    const md = htmlFragmentToMarkdown(clone.innerHTML, td);
    abstract = md.length > 0 ? md : undefined;
  }

  const sections: Section[] = [];
  const topSections = document.querySelectorAll("section.ltx_section");
  for (const sec of Array.from(topSections)) {
    const heading = sec.querySelector("h2, h1");
    sections.push({
      id: sec.getAttribute("id") ?? undefined,
      title: heading?.textContent?.trim() ?? "",
      level: 1,
      content: sectionContent(sec, td),
    });
    for (const sub of Array.from(sec.querySelectorAll("section.ltx_subsection"))) {
      const subHeading = sub.querySelector("h3, h2");
      sections.push({
        id: sub.getAttribute("id") ?? undefined,
        title: subHeading?.textContent?.trim() ?? "",
        level: 2,
        content: sectionContent(sub, td),
      });
    }
  }

  return { title, abstract, sections };
}
```

- [ ] **Step 5: Run the test, expect PASS.** Run: `npx vitest run test/core/parse/html-ar5iv.test.ts`. Expected: PASS.

- [ ] **Step 6: Run typecheck.** Run: `npx tsc --noEmit`. Expected: no errors in this task's files.

- [ ] **Step 7: Commit.** Run:
```
git add src/core/parse/html-ar5iv.ts test/fixtures/ar5iv.html test/core/parse/html-ar5iv.test.ts && git commit -m "feat(core): parse ar5iv (older bare-h1/h2) HTML into ordered sections

- title h1.title.mathjax (ltx_title_document fallback); abstract div.abstract;
  separate branch from html-native — a single selector set cannot parse both schemas.
- shared html-common converter; flatten sections/subsections in order; strip own
  heading + nested subsections per block; zero sections => empty (fallback signal).
"
```

---

### Task D: PDF text extraction (src/core/parse/pdf.ts)

**Files:**
- Source: `/Users/aildan/arxiv/src/core/parse/pdf.ts` (Create)
- Fixture: `/Users/aildan/arxiv/test/fixtures/sample.pdf` (Create, via a setup step)
- Test: `/Users/aildan/arxiv/test/core/parse/pdf.test.ts` (Create)
- Commit: `src/core/parse/pdf.ts`, `test/fixtures/sample.pdf`, `test/fixtures/make-sample-pdf.ts`, `test/core/parse/pdf.test.ts`

**Interfaces:**
- Consumes: `unpdf` (`import { extractText, getDocumentProxy } from "unpdf"`); `Section` from `src/core/types.ts`.
- Produces: `export async function parsePdf(bytes: Uint8Array): Promise<{ title?: string; sections: Section[]; warning: string }>`

**Notes for the implementer:** `unpdf` bundles a worker-free PDF.js. `extractText` accepts a `Uint8Array` (or a PDFDocumentProxy). The v1 behavior (spec §7.2) is deliberately minimal: extract all text, clean it up, and return it as a **single best-effort section** with a fixed `warning`. No heading heuristics.

Cleanup steps on the raw extracted text:
- **De-hyphenate** line-break hyphenation: replace `-\n` (a hyphen at end of line) joining word fragments with the empty string (`foo-\nbar` → `foobar`). Be conservative: only join when a lowercase letter precedes the hyphen and a lowercase letter follows the newline.
- **Collapse whitespace:** turn runs of spaces/newlines into single spaces, then trim. (v1 does not preserve paragraph structure.)

The single returned section: `{ title: "Full text", level: 1, content: <cleaned text> }` (no `id`). `title` at the top level is left `undefined` in v1 (no reliable title heuristic from raw PDF text). `warning` is exactly `"PDF text extraction: single-section, no heading heuristics"`.

The fixture is a tiny valid PDF carrying a **known sentence** so the test is deterministic and offline. Generate it in a committed setup script (so the bytes are reproducible) and commit both the script and the resulting `sample.pdf`.

- [ ] **Step 1: Write the fixture generator and produce sample.pdf.** Create `test/fixtures/make-sample-pdf.ts` — a minimal hand-written PDF emitter (no external deps; the file embeds a single text line). Complete file:

```ts
// Generates test/fixtures/sample.pdf: a minimal one-page PDF whose content
// stream draws a single known sentence. Run with: npx tsx test/fixtures/make-sample-pdf.ts
// Committed alongside the produced sample.pdf so the bytes are reproducible.
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SENTENCE = "The quick brown fox studies super-symmetry.";

function buildPdf(text: string): Uint8Array {
  const objects: string[] = [];
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push("<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  objects.push(
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] " +
      "/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
  );
  const stream = `BT /F1 24 Tf 72 700 Td (${text}) Tj ET`;
  objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (const off of offsets) {
    pdf += `${off.toString().padStart(10, "0")} 00000 n \n`;
  }
  pdf +=
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n` +
    `startxref\n${xrefStart}\n%%EOF`;
  return new Uint8Array(Buffer.from(pdf, "latin1"));
}

const here = dirname(fileURLToPath(import.meta.url));
writeFileSync(join(here, "sample.pdf"), buildPdf(SENTENCE));
// eslint-disable-next-line no-console
console.log("wrote sample.pdf");
```

Run it to produce the committed fixture: `npx tsx test/fixtures/make-sample-pdf.ts`. Confirm `test/fixtures/sample.pdf` exists and starts with `%PDF-1.4`. (If `tsx` is unavailable, run via `node --import tsx test/fixtures/make-sample-pdf.ts`.) Sanity-check that `unpdf` can read it before writing the parser test: `node -e "import('unpdf').then(async u=>{const b=require('fs').readFileSync('test/fixtures/sample.pdf');console.log((await u.extractText(new Uint8Array(b),{mergePages:true})).text)})"` should print the known sentence. If `unpdf` cannot extract from this hand-written PDF on your platform, replace the generator body with a `pdf-lib` (devDependency) emitter that draws the same `SENTENCE` — the test assertions below are unchanged.

- [ ] **Step 2: Write the failing PDF-parse test.** Create `test/core/parse/pdf.test.ts`. Complete file:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parsePdf } from "../../../src/core/parse/pdf.js";

const here = dirname(fileURLToPath(import.meta.url));
const bytes = (): Uint8Array =>
  new Uint8Array(
    readFileSync(join(here, "..", "..", "fixtures", "sample.pdf")),
  );

describe("parsePdf", () => {
  it("returns a single best-effort section with the cleaned sentence", async () => {
    const res = await parsePdf(bytes());
    expect(res.sections).toHaveLength(1);
    expect(res.sections[0].title).toBe("Full text");
    expect(res.sections[0].level).toBe(1);
    expect(res.sections[0].id).toBeUndefined();
    expect(res.sections[0].content).toContain(
      "The quick brown fox studies super-symmetry.",
    );
    expect(res.warning).toBe(
      "PDF text extraction: single-section, no heading heuristics",
    );
  });

  it("collapses whitespace runs to single spaces", () => {
    // unit-level cleanup assertion via the exported helper
    return import("../../../src/core/parse/pdf.js").then(({ cleanupText }) => {
      expect(cleanupText("a   b\n\n  c")).toBe("a b c");
    });
  });

  it("de-hyphenates word-break hyphens across line breaks", () => {
    return import("../../../src/core/parse/pdf.js").then(({ cleanupText }) => {
      expect(cleanupText("super-\nsymmetry")).toBe("supersymmetry");
      // does NOT join a hyphen followed by an uppercase / non-letter
      expect(cleanupText("well-\nKnown")).toContain("well- Known");
    });
  });
});
```

- [ ] **Step 3: Run the test, expect FAIL.** Run: `npx vitest run test/core/parse/pdf.test.ts`. Expected: FAIL — `Cannot find module '../../../src/core/parse/pdf.js'`.

- [ ] **Step 4: Implement src/core/parse/pdf.ts.** Create the file. Complete contents:

```ts
import { extractText, getDocumentProxy } from "unpdf";
import type { Section } from "../types.js";

const WARNING = "PDF text extraction: single-section, no heading heuristics";

/**
 * Clean raw extracted PDF text: join conservative line-break hyphenation
 * (lowercase-hyphen-newline-lowercase), then collapse all whitespace runs to a
 * single space and trim. v1 does not preserve paragraph structure.
 */
export function cleanupText(raw: string): string {
  const dehyphenated = raw.replace(/([a-z])-\n([a-z])/g, "$1$2");
  return dehyphenated.replace(/\s+/g, " ").trim();
}

export async function parsePdf(
  bytes: Uint8Array,
): Promise<{ title?: string; sections: Section[]; warning: string }> {
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: true });
  const content = cleanupText(typeof text === "string" ? text : text.join(" "));
  const sections: Section[] = [{ title: "Full text", level: 1, content }];
  return { title: undefined, sections, warning: WARNING };
}
```

- [ ] **Step 5: Run the test, expect PASS.** Run: `npx vitest run test/core/parse/pdf.test.ts`. Expected: PASS — single section titled "Full text", known sentence present, fixed warning; cleanup helper de-hyphenates conservatively and collapses whitespace.

- [ ] **Step 6: Run typecheck.** Run: `npx tsc --noEmit`. Expected: no errors in this task's files.

- [ ] **Step 7: Commit.** Run:
```
git add src/core/parse/pdf.ts test/fixtures/sample.pdf test/fixtures/make-sample-pdf.ts test/core/parse/pdf.test.ts && git commit -m "feat(core): extract PDF text via unpdf into a single best-effort section

- parsePdf uses unpdf extractText (worker-free PDF.js); cleanupText de-hyphenates
  line-break hyphenation conservatively and collapses whitespace.
- v1 returns one 'Full text' section + fixed warning (no heading heuristics).
- committed tiny hand-written sample.pdf (+ reproducible generator) for an
  offline, deterministic assertion.
"
```

---

### Task E: client.getContent + client.download (replace the Phase-4 stubs)

**Files:**
- Modify: `/Users/aildan/arxiv/src/core/client.ts` (replace the two Phase-6 stub bodies; add imports)
- Test: `/Users/aildan/arxiv/test/core/client-content.test.ts` (Create)
- Commit: `src/core/client.ts`, `test/core/client-content.test.ts`

**Interfaces:**
- Consumes (already imported by Phase 4 or added here): `normalizeId`, `htmlUrl`, `ar5ivUrl`, `pdfUrl`, `absUrl`, `filenameFor` from `./ids.js`; `parseNativeHtml` from `./parse/html-native.js`; `parseAr5ivHtml` from `./parse/html-ar5iv.js`; `parsePdf` from `./parse/pdf.js`; `NotFoundError`, `UnsupportedError`, `ParseError`, `NetworkError` from `./errors.js`; `Section`, `PaperContent`, `ReadOptions`, `DownloadOptions` from `./types.js`; `DataSource` (the `api`/`browser` fields). `node:fs/promises` (`mkdir`, `writeFile`) and `node:path` (`join`).
- Produces: the filled bodies of `ArxivClient.getContent(id, opts?)` and `ArxivClient.download(id, opts?)`.

**Notes for the implementer — source matrix & fallback (spec §7.2, contracts §6):**
- **`source: 'auto'` (default):** native HTML → ar5iv → PDF.
- **`source: 'html'`:** native → ar5iv only; if **both** fail → `UnsupportedError` (never PDF).
- **`source: 'pdf'`:** PDF only (skip HTML).
- **Fallback triggers:** `5xx`/`429` are retried inside `Http` (Phase 3); a step falls through only after retries exhaust. **native→ar5iv on HTTP 404** — `api.getHtml` returns `null` on 404 (contracts §3), that is the trigger. **ar5iv→PDF on {404 (`null`), network error (`NetworkError` thrown), or a 200 that parses to zero sections}.**
- **abs page** is fetched **only** in the two §7.2 cases. In Phase 6's read path the relevant case is: a **caller-pinned `v{n}` 404s** — fetch `absUrl` to discover the max version, re-pin, and retry the same source step once. Unversioned reads never fetch abs. (The other abs case, toBibTeX, is Phase 7.)

**Content caching (contracts §6, spec §8):** the **full** extracted content (all sections) is cached once per `{kind:"content", id, version, source}` tuple via `this.cache?` (guarded — `undefined` when `noCache`). `format`/`section`/`maxChars`/cursor views are computed **in-memory** from the cached full content; chunks are not separately keyed. TTL: versioned → `Infinity`; unversioned/latest → 24h (`24*60*60*1000`).

**Chunking & cursor (the central mechanism):**
- Build the **full** `Section[]` (from whichever parser won) plus resolved `{id, version, source, title, abstract}`. This is the cache value.
- **`section` option wins** over `maxChars`: case-insensitive match **first on `Section.id`**, then **substring on `Section.title`**. Zero matches → `NotFoundError` whose message lists the available section titles. Multiple matches → take the **first by document order** and push a `warning` naming the others. Return that one section as the chunk (`truncated: false`, no `nextCursor`).
- Otherwise **`maxChars`** is a soft target. Starting at `sectionIndex` (0, or the cursor's), accumulate **whole** sections while the running char count stays within `maxChars`; always include at least one section (a single section larger than `maxChars` is returned whole). If `maxChars` is undefined, return **all** remaining sections in one chunk.
- **Cursor** = base64 of `JSON.stringify({ id, version, source, sectionIndex, charOffset: 0 })`. Decode validates the caller-supplied `id` matches the cursor's `id` → else `ParseError`. The decoded `source`/`version` pin the read (a newer published version is ignored mid-read; re-resolve to the same cached tuple, a transparent cache miss if evicted).
- **`nextCursor`** present **iff** more sections remain after this chunk (`endIndex < sections.length`); it encodes `sectionIndex = endIndex`. **`truncated`** is `true` **iff** the read was chunked at all — i.e. a cursor was supplied OR a `nextCursor` is produced OR a single `section` was selected from a multi-section doc. (Practically: `truncated = !!opts.cursor || !!nextCursor || (sectionSelected && sections.length > 1)`.)
- **`format`:** `'markdown'` (default) returns the section content as-is (already Markdown from html-common; PDF text is plain but stored in `content`). `'text'` is a best-effort strip — for v1, when `format: 'text'`, return the same `content` (Markdown is already close to plain for our fixtures); set `PaperContent.format` accordingly. `text` field of `PaperContent` = the chunk's section contents joined by `"\n\n"`.

**`download` (contracts §6):** `n = normalizeId(id)`; `dir = opts?.dir ?? cfg.downloadsDir`; `bytes = await api.getPdf(pdfUrl(n))`; `await mkdir(dir, {recursive:true})`; `path = join(dir, filenameFor(n))`; `await writeFile(path, bytes)`; return `{ path, bytes: bytes.byteLength }`. Print nothing (the CLI prints the path). Uses the same `api` DataSource and `ids.ts` builders.

- [ ] **Step 1: Write the failing content/cursor/download test (fake DataSource injection).** Create `test/core/client-content.test.ts`. The test injects a fake `DataSource` by constructing the client and replacing its private `api` field (cast through `unknown`); each fake returns fixtures or throws chosen errors. Complete file:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ArxivClient } from "../../src/core/client.js";
import type { DataSource } from "../../src/core/datasource/datasource.js";
import { NotFoundError } from "../../src/core/errors.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): string =>
  readFileSync(join(here, "..", "fixtures", name), "utf8");
const pdfBytes = (): Uint8Array =>
  new Uint8Array(readFileSync(join(here, "..", "fixtures", "sample.pdf")));

const NATIVE = fixture("native.html");
const AR5IV = fixture("ar5iv.html");

/** Build a client with caching disabled and a fake DataSource injected. */
function clientWith(fake: Partial<DataSource>): ArxivClient {
  const client = new ArxivClient({ noCache: true });
  const ds: DataSource = {
    query: async () => {
      throw new Error("query not used");
    },
    getHtml: async () => null,
    getPdf: async () => pdfBytes(),
    getText: async () => {
      throw new Error("getText not used");
    },
    ...fake,
  };
  // Inject over the private `api` field for the test.
  (client as unknown as { api: DataSource }).api = ds;
  return client;
}

describe("getContent source matrix", () => {
  it("auto: returns native HTML content when native is available", async () => {
    const client = clientWith({
      getHtml: async (url) => (url.includes("/html/") ? NATIVE : null),
    });
    const res = await client.getContent("2310.06825");
    expect(res.source).toBe("html-native");
    expect(res.title).toBe("A Native LaTeXML Paper");
    expect(res.sections.map((s) => s.id)).toEqual(["S1", "S1.SS1", "S2"]);
  });

  it("auto: falls through native(404) -> ar5iv", async () => {
    const client = clientWith({
      getHtml: async (url) =>
        url.includes("ar5iv") ? AR5IV : null, // native 404 -> null
    });
    const res = await client.getContent("cond-mat/0011267");
    expect(res.source).toBe("html-ar5iv");
    expect(res.title).toBe("An ar5iv Historical Paper");
  });

  it("auto: falls through native(404) -> ar5iv(404) -> PDF", async () => {
    const client = clientWith({ getHtml: async () => null });
    const res = await client.getContent("hep-th/9901001");
    expect(res.source).toBe("pdf");
    expect(res.sections).toHaveLength(1);
    expect(res.sections[0].content).toContain("super-symmetry");
    expect(res.warnings).toContain(
      "PDF text extraction: single-section, no heading heuristics",
    );
  });

  it("auto: ar5iv 200-with-zero-sections triggers PDF fallback", async () => {
    const client = clientWith({
      getHtml: async (url) =>
        url.includes("ar5iv") ? "<html><body><p>no sections</p></body></html>" : null,
    });
    const res = await client.getContent("hep-th/9901002");
    expect(res.source).toBe("pdf");
  });

  it("html: native(404)+ar5iv(404) -> UnsupportedError (never PDF)", async () => {
    let pdfCalled = false;
    const client = clientWith({
      getHtml: async () => null,
      getPdf: async () => {
        pdfCalled = true;
        return pdfBytes();
      },
    });
    await expect(
      client.getContent("hep-th/9901003", { source: "html" }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED" });
    expect(pdfCalled).toBe(false);
  });

  it("pdf: skips HTML entirely", async () => {
    let htmlCalled = false;
    const client = clientWith({
      getHtml: async () => {
        htmlCalled = true;
        return NATIVE;
      },
    });
    const res = await client.getContent("2310.06825", { source: "pdf" });
    expect(res.source).toBe("pdf");
    expect(htmlCalled).toBe(false);
  });
});

describe("getContent section selection", () => {
  it("selects by id (case-insensitive), wins over maxChars", async () => {
    const client = clientWith({
      getHtml: async (url) => (url.includes("/html/") ? NATIVE : null),
    });
    const res = await client.getContent("2310.06825", {
      section: "s1.ss1",
      maxChars: 1,
    });
    expect(res.sections).toHaveLength(1);
    expect(res.sections[0].id).toBe("S1.SS1");
    expect(res.truncated).toBe(true);
    expect(res.nextCursor).toBeUndefined();
  });

  it("selects by title substring when id does not match", async () => {
    const client = clientWith({
      getHtml: async (url) => (url.includes("/html/") ? NATIVE : null),
    });
    const res = await client.getContent("2310.06825", { section: "methods" });
    expect(res.sections[0].id).toBe("S2");
    expect(res.sections[0].title).toBe("Methods");
  });

  it("zero matches -> NotFoundError listing titles", async () => {
    const client = clientWith({
      getHtml: async (url) => (url.includes("/html/") ? NATIVE : null),
    });
    await expect(
      client.getContent("2310.06825", { section: "nope" }),
    ).rejects.toThrow(/Introduction|Methods/);
  });
});

describe("getContent cursor round-trip", () => {
  it("walks nextCursor to completion with whole-section chunks", async () => {
    const client = clientWith({
      getHtml: async (url) => (url.includes("/html/") ? NATIVE : null),
    });
    const collected: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const res = await client.getContent("2310.06825", {
        maxChars: 1, // tiny target => one whole section per chunk
        cursor,
      });
      // each chunk holds at least one whole section, never a fragment
      expect(res.sections.length).toBeGreaterThanOrEqual(1);
      for (const s of res.sections) collected.push(s.id ?? s.title);
      // truncated true whenever the read is chunked
      expect(res.truncated).toBe(true);
      cursor = res.nextCursor;
      pages++;
      expect(pages).toBeLessThan(10); // guard against infinite loop
    } while (cursor);
    expect(collected).toEqual(["S1", "S1.SS1", "S2"]);
  });

  it("rejects a cursor presented with a different id -> ParseError", async () => {
    const client = clientWith({
      getHtml: async (url) => (url.includes("/html/") ? NATIVE : null),
    });
    const first = await client.getContent("2310.06825", { maxChars: 1 });
    expect(first.nextCursor).toBeDefined();
    await expect(
      client.getContent("2401.00001", { cursor: first.nextCursor }),
    ).rejects.toMatchObject({ code: "PARSE" });
  });

  it("the last chunk has no nextCursor", async () => {
    const client = clientWith({
      getHtml: async (url) => (url.includes("/html/") ? NATIVE : null),
    });
    // big maxChars => single chunk, all sections, no nextCursor, not truncated
    const res = await client.getContent("2310.06825", { maxChars: 100000 });
    expect(res.sections.map((s) => s.id)).toEqual(["S1", "S1.SS1", "S2"]);
    expect(res.nextCursor).toBeUndefined();
    expect(res.truncated).toBe(false);
  });
});

describe("download", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "arxiv-dl-"));
  });

  it("writes the PDF to dir/filenameFor(id) and returns path+bytes", async () => {
    const bytes = pdfBytes();
    const client = clientWith({ getPdf: async () => bytes });
    const out = await client.download("cond-mat/0011267v1", { dir });
    expect(out.path).toBe(join(dir, "cond-mat_0011267v1.pdf"));
    expect(out.bytes).toBe(bytes.byteLength);
    const written = await readFile(out.path);
    expect(new Uint8Array(written)).toEqual(bytes);
    await rm(dir, { recursive: true, force: true });
  });

  it("propagates NotFoundError from getPdf", async () => {
    const client = clientWith({
      getPdf: async () => {
        throw new NotFoundError("nope");
      },
    });
    await expect(client.download("0000.00000", { dir })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await rm(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run the test, expect FAIL.** Run: `npx vitest run test/core/client-content.test.ts`. Expected: FAIL — `getContent`/`download` still throw the Phase-4 stub errors (`getContent: implemented in Phase 6` / `download: implemented in Phase 6`), so every assertion fails.

- [ ] **Step 3: Add the Phase-6 imports to client.ts.** The Phase-4 import block (contracts §4) does not yet import the parsers, the extra id builders, `node:fs`/`node:path`, or the content errors. Insert these imports after the existing `import { ApiDataSource } from "./datasource/api.js";` line in `src/core/client.ts`:

```ts
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  normalizeId,
  htmlUrl,
  ar5ivUrl,
  pdfUrl,
  absUrl,
  filenameFor,
} from "./ids.js";
import { parseNativeHtml } from "./parse/html-native.js";
import { parseAr5ivHtml } from "./parse/html-ar5iv.js";
import { parsePdf } from "./parse/pdf.js";
import {
  NotFoundError,
  UnsupportedError,
  ParseError,
  NetworkError,
} from "./errors.js";
import type { Section, NormalizedId } from "./types.js";
```

(If Phase 4 already imports `normalizeId`/`absUrl`/`pdfUrl`/`filenameFor`/`NotFoundError`/`NetworkError` for `search`/`getPaper`, drop the duplicate names from the block above — keep only the not-yet-imported ones: `htmlUrl`, `ar5ivUrl`, the three parsers, `UnsupportedError`, `ParseError`, `Section`, `NormalizedId`, `mkdir`, `writeFile`, `join`. The repo must compile with no duplicate-import errors.)

- [ ] **Step 4: Add the private content helpers to the class.** Insert these private methods inside the `ArxivClient` class body (e.g. just above the `// Phase 6:` marker). Complete code:

```ts
  // ---- Phase 6 helpers (content extraction, fallback, cursor) ----

  private contentTtl(n: NormalizedId): number {
    return n.version !== undefined ? Infinity : 24 * 60 * 60 * 1000;
  }

  /** Full extracted content for one resolved source (the cache value shape). */
  private async extractContent(
    n: NormalizedId,
    source: "auto" | "html" | "pdf",
  ): Promise<{
    source: "html-native" | "html-ar5iv" | "pdf";
    title: string;
    abstract?: string;
    sections: Section[];
    warnings: string[];
  }> {
    const warnings: string[] = [];

    const tryNative = async () => {
      const html = await this.api.getHtml(htmlUrl(n)); // null on 404
      if (html === null) return null;
      const parsed = parseNativeHtml(html);
      if (parsed.sections.length === 0) return null; // unexpected page => fall through
      return {
        source: "html-native" as const,
        title: parsed.title,
        abstract: parsed.abstract,
        sections: parsed.sections,
      };
    };

    const tryAr5iv = async () => {
      let html: string | null;
      try {
        html = await this.api.getHtml(ar5ivUrl(n)); // null on 404
      } catch (err) {
        if (err instanceof NetworkError) return null; // network => fall through to PDF
        throw err;
      }
      if (html === null) return null;
      const parsed = parseAr5ivHtml(html);
      if (parsed.sections.length === 0) return null; // 200-with-zero-sections => fall through
      warnings.push("ar5iv fallback used");
      return {
        source: "html-ar5iv" as const,
        title: parsed.title,
        abstract: parsed.abstract,
        sections: parsed.sections,
      };
    };

    const tryPdf = async () => {
      const bytes = await this.api.getPdf(pdfUrl(n)); // throws NotFoundError on 404
      const parsed = await parsePdf(bytes);
      warnings.push(parsed.warning);
      return {
        source: "pdf" as const,
        title: parsed.title ?? "",
        abstract: undefined,
        sections: parsed.sections,
      };
    };

    if (source === "pdf") {
      const pdf = await tryPdf();
      return { ...pdf, warnings };
    }

    const native = await tryNative();
    if (native) return { ...native, warnings };

    const ar5iv = await tryAr5iv();
    if (ar5iv) return { ...ar5iv, warnings };

    if (source === "html") {
      throw new UnsupportedError(
        `No HTML rendering available for ${n.idWithVersion ?? n.id} (native and ar5iv both unavailable); try --source pdf`,
      );
    }

    // source === "auto": universal PDF fallback.
    const pdf = await tryPdf();
    return { ...pdf, warnings };
  }
```

- [ ] **Step 5: Replace the `getContent` stub body.** In `src/core/client.ts`, find the exact Phase-4 stub line:

```ts
  async getContent(id: string, opts?: ReadOptions): Promise<PaperContent> { throw new Error("getContent: implemented in Phase 6"); }
```

and replace that one line with the full method:

```ts
  async getContent(id: string, opts?: ReadOptions): Promise<PaperContent> {
    const n = normalizeId(id);
    const source = opts?.source ?? "auto";
    const format = opts?.format ?? "markdown";

    // A cursor pins {id, version, source, sectionIndex}; validate id match first.
    let startIndex = 0;
    if (opts?.cursor) {
      const decoded = decodeCursor(opts.cursor);
      if (decoded.id !== n.id) {
        throw new ParseError(
          `Cursor id mismatch: cursor is for ${decoded.id}, requested ${n.id}`,
        );
      }
      startIndex = decoded.sectionIndex;
    }

    // Resolve the full content for {id, version, source}, with caching.
    const cacheKey = (resolved: string) => ({
      kind: "content" as const,
      id: n.id,
      version: n.version,
      source: resolved,
    });

    let full:
      | {
          source: "html-native" | "html-ar5iv" | "pdf";
          title: string;
          abstract?: string;
          sections: Section[];
          warnings: string[];
        }
      | undefined;

    // When a cursor pins a source we can hit the cache directly for that tuple.
    if (opts?.cursor) {
      const decoded = decodeCursor(opts.cursor);
      const cached = await this.cache?.get<typeof full>(
        cacheKey(decoded.source),
      );
      if (cached) full = cached;
    }

    if (!full) {
      full = await this.extractContent(n, source);
      await this.cache?.set(
        cacheKey(full.source),
        full,
        this.contentTtl(n),
      );
    }

    const warnings = [...full.warnings];
    const allSections = full.sections;

    // ---- section selection wins over maxChars ----
    if (opts?.section) {
      const needle = opts.section.toLowerCase();
      let matches = allSections.filter(
        (s) => (s.id ?? "").toLowerCase() === needle,
      );
      if (matches.length === 0) {
        matches = allSections.filter((s) =>
          s.title.toLowerCase().includes(needle),
        );
      }
      if (matches.length === 0) {
        const titles = allSections.map((s) => s.title).join(", ");
        throw new NotFoundError(
          `No section matching "${opts.section}". Available: ${titles}`,
        );
      }
      if (matches.length > 1) {
        const others = matches
          .slice(1)
          .map((s) => s.title)
          .join(", ");
        warnings.push(
          `Multiple sections matched "${opts.section}"; returning the first. Others: ${others}`,
        );
      }
      const chosen = matches[0];
      return this.assemble(n, full, [chosen], {
        format,
        truncated: allSections.length > 1,
        nextCursor: undefined,
        warnings,
      });
    }

    // ---- maxChars soft target: accumulate whole sections ----
    const maxChars = opts?.maxChars;
    let endIndex = startIndex;
    let acc = 0;
    while (endIndex < allSections.length) {
      const len = allSections[endIndex].content.length;
      if (
        maxChars !== undefined &&
        endIndex > startIndex &&
        acc + len > maxChars
      ) {
        break; // adding this section would exceed the target; stop (keep ≥1)
      }
      acc += len;
      endIndex++;
      if (maxChars === undefined) {
        // no target => take everything in one chunk
        endIndex = allSections.length;
        break;
      }
    }

    const chunk = allSections.slice(startIndex, endIndex);
    const hasMore = endIndex < allSections.length;
    const nextCursor = hasMore
      ? encodeCursor({
          id: n.id,
          version: n.version,
          source: full.source,
          sectionIndex: endIndex,
          charOffset: 0,
        })
      : undefined;
    const truncated = !!opts?.cursor || hasMore;

    return this.assemble(n, full, chunk, {
      format,
      truncated,
      nextCursor,
      warnings,
    });
  }

  /** Build a PaperContent response from a chunk of sections. */
  private assemble(
    n: NormalizedId,
    full: {
      source: "html-native" | "html-ar5iv" | "pdf";
      title: string;
      abstract?: string;
    },
    chunk: Section[],
    opts: {
      format: "markdown" | "text";
      truncated: boolean;
      nextCursor?: string;
      warnings: string[];
    },
  ): PaperContent {
    return {
      id: n.id,
      version: n.version,
      source: full.source,
      format: opts.format,
      title: full.title,
      abstract: full.abstract,
      sections: chunk,
      text: chunk.map((s) => s.content).join("\n\n"),
      truncated: opts.truncated,
      nextCursor: opts.nextCursor,
      warnings: opts.warnings.length > 0 ? opts.warnings : undefined,
    };
  }
```

- [ ] **Step 6: Replace the `download` stub body.** In `src/core/client.ts`, find the exact Phase-4 stub line:

```ts
  async download(id: string, opts?: DownloadOptions): Promise<{ path: string; bytes: number }> { throw new Error("download: implemented in Phase 6"); }
```

and replace that one line with the full method:

```ts
  async download(
    id: string,
    opts?: DownloadOptions,
  ): Promise<{ path: string; bytes: number }> {
    const n = normalizeId(id);
    const dir = opts?.dir ?? this.cfg.downloadsDir;
    const bytes = await this.api.getPdf(pdfUrl(n));
    await mkdir(dir, { recursive: true });
    const path = join(dir, filenameFor(n));
    await writeFile(path, bytes);
    return { path, bytes: bytes.byteLength };
  }
```

- [ ] **Step 7: Add the cursor codec at module scope (bottom of client.ts).** Append these helpers below the `ArxivClient` class in `src/core/client.ts`:

```ts
interface CursorPayload {
  id: string;
  version?: number;
  source: "html-native" | "html-ar5iv" | "pdf";
  sectionIndex: number;
  charOffset: number;
}

function encodeCursor(p: CursorPayload): string {
  return Buffer.from(JSON.stringify(p), "utf8").toString("base64");
}

function decodeCursor(cursor: string): CursorPayload {
  try {
    const json = Buffer.from(cursor, "base64").toString("utf8");
    const p = JSON.parse(json) as CursorPayload;
    if (
      typeof p.id !== "string" ||
      typeof p.sectionIndex !== "number" ||
      (p.source !== "html-native" &&
        p.source !== "html-ar5iv" &&
        p.source !== "pdf")
    ) {
      throw new ParseError("Malformed cursor payload");
    }
    return p;
  } catch (err) {
    if (err instanceof ParseError) throw err;
    throw new ParseError(`Invalid cursor: ${String(err)}`);
  }
}
```

- [ ] **Step 8: Run the content test, expect PASS.** Run: `npx vitest run test/core/client-content.test.ts`. Expected: PASS — full source matrix (native; native→ar5iv; native→ar5iv→PDF; ar5iv-zero-sections→PDF; `html` both-fail→UnsupportedError and never calls getPdf; `pdf` skips HTML), section selection (id, title, zero→NotFoundError), the cursor round-trip (whole-section chunks, `["S1","S1.SS1","S2"]`, last chunk has no `nextCursor`, `truncated` invariants), id-mismatch→ParseError, and download (writes `cond-mat_0011267v1.pdf`, returns path+bytes; propagates NotFoundError).

- [ ] **Step 9: Run the full Phase-6 suite + typecheck.** Run: `npx vitest run test/core/parse test/core/client-content.test.ts`. Expected: PASS (Tasks A–E). Run: `npx tsc --noEmit`. Expected: PASS (no errors originating in `client.ts` or the parse modules). If `tsc` flags the test's private-field injection cast, confirm it is the `(client as unknown as { api: DataSource }).api = ds;` line and that it compiles (the double-cast through `unknown` is intentional and type-checks).

- [ ] **Step 10: Commit.** Run:
```
git add src/core/client.ts test/core/client-content.test.ts && git commit -m "feat(core): implement getContent (source matrix + cursor) and download

- getContent: auto = native→ar5iv→PDF; html = native→ar5iv only (both fail =>
  UnsupportedError, never PDF); pdf = PDF only. Fallback triggers per §7.2
  (native→ar5iv on 404; ar5iv→PDF on 404/network/200-zero-sections; 5xx/429
  retried in Http first). Full content cached per {kind,id,version,source}.
- chunking: section wins over maxChars (id then title substring; zero =>
  NotFoundError listing titles; multiple => first + warning); maxChars is a soft
  target accumulating whole sections; cursor = base64 {id,version,source,
  sectionIndex,charOffset:0}; decode validates id => else ParseError; nextCursor
  iff more remains; truncated iff chunked.
- download: getPdf(pdfUrl) -> mkdir -> write filenameFor into opts.dir ?? cfg.downloadsDir.
- replaces the Phase-4 getContent/download stubs; fake DataSource drives the full matrix.
"
```

---

## Phase 7: Metadata + BibTeX

<!-- Phase: Metadata + BibTeX -->

### Task A — BibTeX generator (src/core/bibtex.ts)

**Files:**
- Test: `/Users/aildan/arxiv/test/core/bibtex.test.ts` (Create)
- Source: `/Users/aildan/arxiv/src/core/bibtex.ts` (Create)
- Commit: `src/core/bibtex.ts`, `test/core/bibtex.test.ts`

**Interfaces:**
- Consumes: `Paper`, `Author` from `src/core/types.ts`
- Produces:
  - `export function generateBibTeX(paper: Paper): string`

**Notes for the implementer:** `generateBibTeX` must produce exactly the `@misc` template from spec §7.3:
- Key: `<firstAuthorLast><year><firstTitleWord>` — all lowercase. `firstAuthorLast` = last whitespace-token of `authors[0].name`. `year` = 4-digit year extracted from `paper.published` (first four characters, e.g. `"2023-10-10T..."` → `"2023"`). `firstTitleWord` = first token in `paper.title` that contains at least one alphabetic character (`/[a-zA-Z]/`), then stripped of all non-alphanumeric characters and lowercased.
- `eprint`: bare `paper.id` verbatim — the slash in old-style IDs is kept as-is (e.g. `cond-mat/0011267`).
- `archivePrefix`: always the literal string `arXiv`.
- `primaryClass`: `paper.primaryCategory`.
- `url`: `https://arxiv.org/abs/<paper.id>`.
- `author`: `paper.authors.map(a => a.name).join(" and ")`.
- `doi={…}`: emitted only when `paper.doi` is defined and non-empty; placed immediately after `url`.
- Field indentation: eight spaces before each field name; field separator: `,\n` (comma then newline). Last field also carries a trailing comma before the closing `}`.
- The output format is:
  ```
  @misc{<key>,\n        title={<title>},\n        author={<authors>},\n        year={<year>},\n        eprint={<id>},\n        archivePrefix={arXiv},\n        primaryClass={<primaryCategory>},\n        url={https://arxiv.org/abs/<id>},\n}
  ```
  When `doi` is present it appears between `url` and the closing brace:
  ```
        doi={<doi>},\n
  ```

- [ ] **Step 1: Write the failing test file.** Create `test/core/bibtex.test.ts`. Complete file:

```ts
import { describe, it, expect } from "vitest";
import { generateBibTeX } from "../../src/core/bibtex.js";
import type { Paper } from "../../src/core/types.js";

// Minimal Paper fixture for testing — only fields generateBibTeX reads.
function makePaper(overrides: Partial<Paper> = {}): Paper {
  return {
    id: "2310.06825",
    title: "Attention Is All You Need",
    summary: "We propose a new simple network architecture, the Transformer.",
    authors: [
      { name: "Ashish Vaswani" },
      { name: "Noam Shazeer" },
      { name: "Niki Parmar" },
    ],
    categories: ["cs.CL", "cs.AI"],
    primaryCategory: "cs.CL",
    published: "2017-06-12T00:00:00Z",
    updated: "2017-06-12T00:00:00Z",
    links: {
      abs: "https://arxiv.org/abs/2310.06825",
      pdf: "https://arxiv.org/pdf/2310.06825",
    },
    ...overrides,
  };
}

describe("generateBibTeX", () => {
  it("produces the correct @misc template for a new-style id without doi", () => {
    const paper = makePaper();
    const bib = generateBibTeX(paper);
    const expected =
      "@misc{vaswani2017attention,\n" +
      "        title={Attention Is All You Need},\n" +
      "        author={Ashish Vaswani and Noam Shazeer and Niki Parmar},\n" +
      "        year={2017},\n" +
      "        eprint={2310.06825},\n" +
      "        archivePrefix={arXiv},\n" +
      "        primaryClass={cs.CL},\n" +
      "        url={https://arxiv.org/abs/2310.06825},\n" +
      "}";
    expect(bib).toBe(expected);
  });

  it("includes doi field when paper.doi is present", () => {
    const paper = makePaper({ doi: "10.48550/arXiv.2310.06825" });
    const bib = generateBibTeX(paper);
    expect(bib).toContain(
      "        url={https://arxiv.org/abs/2310.06825},\n" +
        "        doi={10.48550/arXiv.2310.06825},\n"
    );
    expect(bib.endsWith("}")).toBe(true);
  });

  it("omits doi field when paper.doi is undefined", () => {
    const paper = makePaper();
    const bib = generateBibTeX(paper);
    expect(bib).not.toContain("doi=");
  });

  it("omits doi field when paper.doi is empty string", () => {
    const paper = makePaper({ doi: "" });
    const bib = generateBibTeX(paper);
    expect(bib).not.toContain("doi=");
  });

  it("keeps the slash verbatim in old-style eprint ids", () => {
    const paper = makePaper({
      id: "cond-mat/0011267",
      authors: [{ name: "J. Doe" }],
      published: "2000-11-01T00:00:00Z",
      title: "Some Paper Title",
      primaryCategory: "cond-mat",
      links: {
        abs: "https://arxiv.org/abs/cond-mat/0011267",
        pdf: "https://arxiv.org/pdf/cond-mat/0011267",
      },
    });
    const bib = generateBibTeX(paper);
    expect(bib).toContain("eprint={cond-mat/0011267}");
    expect(bib).toContain("url={https://arxiv.org/abs/cond-mat/0011267}");
  });

  it("builds the key from last token of first author name, year, first alphabetic title word", () => {
    // "J. Doe" → last token "Doe" → "doe"; year "2000"; first alpha title word "some"
    const paper = makePaper({
      id: "cond-mat/0011267",
      authors: [{ name: "J. Doe" }],
      published: "2000-11-01T00:00:00Z",
      title: "Some Paper Title",
      primaryCategory: "cond-mat",
      links: {
        abs: "https://arxiv.org/abs/cond-mat/0011267",
        pdf: "https://arxiv.org/pdf/cond-mat/0011267",
      },
    });
    const bib = generateBibTeX(paper);
    expect(bib.startsWith("@misc{doe2000some,")).toBe(true);
  });

  it("strips non-alphanumeric characters from the first title word in the key", () => {
    // title begins with a non-word token then a real word
    const paper = makePaper({
      title: "100% Accurate: A Study",
      authors: [{ name: "Alice Smith" }],
      published: "2021-03-15T00:00:00Z",
    });
    const bib = generateBibTeX(paper);
    // "100%" — contains digits and %, first alphabetic char is none; next token "Accurate" has alpha
    // firstTitleWord = "accurate" (non-alphanumeric stripped = "accurate")
    expect(bib.startsWith("@misc{smith2021accurate,")).toBe(true);
  });

  it("and-joins authors", () => {
    const paper = makePaper({
      authors: [{ name: "Alice Smith" }, { name: "Bob Jones" }],
    });
    const bib = generateBibTeX(paper);
    expect(bib).toContain("author={Alice Smith and Bob Jones}");
  });

  it("uses a single author without 'and'", () => {
    const paper = makePaper({
      authors: [{ name: "Alice Smith" }],
    });
    const bib = generateBibTeX(paper);
    expect(bib).toContain("author={Alice Smith}");
  });

  it("extracts the year from the ISO published string", () => {
    const paper = makePaper({ published: "2023-10-10T00:00:00Z" });
    const bib = generateBibTeX(paper);
    expect(bib).toContain("year={2023}");
  });

  it("key is always lowercase", () => {
    const paper = makePaper({
      authors: [{ name: "UPPER CASE" }],
      title: "CAPS Title",
      published: "2020-01-01T00:00:00Z",
    });
    const bib = generateBibTeX(paper);
    const keyLine = bib.split("\n")[0];
    // key portion between { and ,
    const key = keyLine.replace("@misc{", "").replace(",", "");
    expect(key).toBe(key.toLowerCase());
  });
});
```

- [ ] **Step 2: Run the test, expect FAIL.** Run: `npx vitest run test/core/bibtex.test.ts`. Expected: FAIL — `Cannot find module '../../src/core/bibtex.js'`.

- [ ] **Step 3: Implement src/core/bibtex.ts.** Create the file. Complete contents:

```ts
import type { Paper } from "./types.js";

/**
 * Derive the BibTeX cite key from a Paper.
 * Key = <firstAuthorLast><year><firstTitleWord>, all lowercase.
 * - firstAuthorLast: last whitespace-separated token of authors[0].name
 * - year: first 4 characters of paper.published
 * - firstTitleWord: first whitespace token in title that contains at least one
 *   alphabetic character, with all non-alphanumeric characters stripped, lowercased.
 */
function buildKey(paper: Paper): string {
  const firstAuthorName = paper.authors[0]?.name ?? "unknown";
  const tokens = firstAuthorName.trim().split(/\s+/);
  const firstAuthorLast = (tokens[tokens.length - 1] ?? "unknown").toLowerCase();

  const year = paper.published.slice(0, 4);

  const titleTokens = paper.title.trim().split(/\s+/);
  let firstTitleWord = "untitled";
  for (const tok of titleTokens) {
    if (/[a-zA-Z]/.test(tok)) {
      firstTitleWord = tok.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
      break;
    }
  }

  return `${firstAuthorLast}${year}${firstTitleWord}`;
}

/**
 * Generate an offline @misc BibTeX entry for the given Paper.
 * Follows the template from spec §7.3 exactly.
 * The `doi` field is emitted only when `paper.doi` is defined and non-empty.
 */
export function generateBibTeX(paper: Paper): string {
  const key = buildKey(paper);
  const year = paper.published.slice(0, 4);
  const authorStr = paper.authors.map((a) => a.name).join(" and ");
  const url = `https://arxiv.org/abs/${paper.id}`;

  const indent = "        ";

  let out = `@misc{${key},\n`;
  out += `${indent}title={${paper.title}},\n`;
  out += `${indent}author={${authorStr}},\n`;
  out += `${indent}year={${year}},\n`;
  out += `${indent}eprint={${paper.id}},\n`;
  out += `${indent}archivePrefix={arXiv},\n`;
  out += `${indent}primaryClass={${paper.primaryCategory}},\n`;
  out += `${indent}url={${url}},\n`;
  if (paper.doi && paper.doi.length > 0) {
    out += `${indent}doi={${paper.doi}},\n`;
  }
  out += `}`;

  return out;
}
```

- [ ] **Step 4: Run the test, expect PASS.** Run: `npx vitest run test/core/bibtex.test.ts`. Expected: PASS — all fixture assertions green, including key derivation, old-style slash, doi presence/absence, author joining, and lowercase key.

- [ ] **Step 5: Run typecheck.** Run: `npx tsc --noEmit`. Expected: no type errors originating in `src/core/bibtex.ts` or `test/core/bibtex.test.ts`.

- [ ] **Step 6: Commit.**

```
git add src/core/bibtex.ts test/core/bibtex.test.ts && git commit -m "feat(core): add generateBibTeX offline @misc generator

- generateBibTeX(paper) produces the exact §7.3 @misc template: title, author
  (and-joined), year (4-digit from published), eprint (bare id, slash kept for
  old-style), archivePrefix=arXiv, primaryClass, url; doi only when present.
- Key = <firstAuthorLast><year><firstTitleWord>, all lowercase.
- Tests cover new/old-style ids, doi present/absent, key derivation, and-join,
  non-alphabetic title-prefix skipping, and key lowercase invariant.
"
```

---

### Task B — client.ts: implement toBibTeX (replace Phase 4 stub)

**Files:**
- Test: `/Users/aildan/arxiv/test/core/client-bibtex.test.ts` (Create)
- Source: `/Users/aildan/arxiv/src/core/client.ts` (Modify — replace the one-line stub body)
- Commit: `src/core/client.ts`, `test/core/client-bibtex.test.ts`

**Interfaces:**
- Consumes:
  - `bibtexUrl`, `normalizeId` from `src/core/ids.js`
  - `generateBibTeX` from `src/core/bibtex.js`
  - `DataSource` (`getText(url): Promise<string>`) injected via `this.api`
  - `this.getPaper(id)` (fully implemented in Phase 4)
- Produces:
  - `toBibTeX(id: string): Promise<string>` on `ArxivClient`

**Notes for the implementer:** The Phase 4 stub body is the exact string:
```
throw new Error("toBibTeX: implemented in Phase 7");
```
Replace **only that method body** using an Edit-style targeted replacement. The logic is:

1. Normalize `id` to a `NormalizedId` via `normalizeId(id)`.
2. Construct the canonical URL via `bibtexUrl(n)`.
3. Call `await this.api.getText(bibtexUrl(n))` and return the result verbatim.
4. If `this.api.getText` throws for any reason, fall back: call `await this.getPaper(id)`, pass the returned `Paper` to `generateBibTeX(paper)`, and return that string.

No caching of the BibTeX text is performed (keeping it simple and consistent with contracts §6 which does not mention a BibTeX cache key). `getPaper` already benefits from the metadata cache, so the fallback path is naturally efficient.

The `generateBibTeX` import must be added to `client.ts`. The `bibtexUrl` import is already present from Phase 4 (Phase 4 creates `ids.ts` and `client.ts` imports it for `getPaper`/`getPapers`). If `bibtexUrl` is not yet imported in `client.ts`, add it to the existing import from `"./ids.js"`.

**Test strategy:** Inject a fake `DataSource` that satisfies the interface. Use `vi.spyOn` or a hand-rolled fake object. `getPaper` is the live method from `ArxivClient` and would hit the network — instead, subclass or monkey-patch `getPaper` on the instance under test to return a fixture `Paper` without touching the network.

- [ ] **Step 1: Write the failing test file.** Create `test/core/client-bibtex.test.ts`. Complete file:

```ts
import { describe, it, expect, vi } from "vitest";
import { ArxivClient } from "../../src/core/client.js";
import type { DataSource } from "../../src/core/datasource/datasource.js";
import type { Paper } from "../../src/core/types.js";
import { generateBibTeX } from "../../src/core/bibtex.js";

// A Paper fixture used both as getPaper's return value and as a source of truth
// for the generated fallback string.
const FIXTURE_PAPER: Paper = {
  id: "2310.06825",
  title: "Attention Is All You Need",
  summary: "We propose a new network architecture, the Transformer.",
  authors: [{ name: "Ashish Vaswani" }, { name: "Noam Shazeer" }],
  categories: ["cs.CL", "cs.AI"],
  primaryCategory: "cs.CL",
  published: "2017-06-12T00:00:00Z",
  updated: "2017-06-12T00:00:00Z",
  links: {
    abs: "https://arxiv.org/abs/2310.06825",
    pdf: "https://arxiv.org/pdf/2310.06825",
  },
};

const CANONICAL_BIBTEX = `@misc{vaswani2017attention_canonical,
  author = {Ashish Vaswani and Noam Shazeer},
  title  = {Attention Is All You Need},
  year   = {2017},
  url    = {https://arxiv.org/abs/2310.06825}
}`;

/**
 * Build a minimal DataSource whose getText resolves or rejects as needed.
 * All other methods throw — they should never be called by toBibTeX.
 */
function makeDataSource(
  getTextImpl: (url: string) => Promise<string>
): DataSource {
  return {
    query: () => Promise.reject(new Error("query: not expected")),
    getHtml: () => Promise.reject(new Error("getHtml: not expected")),
    getPdf: () => Promise.reject(new Error("getPdf: not expected")),
    getText: getTextImpl,
  };
}

/**
 * Construct an ArxivClient whose `this.api` is replaced by our fake DataSource.
 * We also stub `getPaper` on the instance so it returns FIXTURE_PAPER without
 * hitting the network.
 */
function makeClient(ds: DataSource): ArxivClient {
  // Pass noCache so Cache is not constructed (avoids needing a real cacheDir).
  const client = new ArxivClient({ noCache: true });
  // Replace the internal api field — it is private but accessible via bracket notation in JS.
  (client as unknown as Record<string, unknown>)["api"] = ds;
  // Stub getPaper to return the fixture without a network call.
  vi.spyOn(client, "getPaper").mockResolvedValue(FIXTURE_PAPER);
  return client;
}

describe("ArxivClient.toBibTeX", () => {
  it("returns the canonical string verbatim when getText succeeds", async () => {
    const ds = makeDataSource(() => Promise.resolve(CANONICAL_BIBTEX));
    const client = makeClient(ds);
    const result = await client.toBibTeX("2310.06825");
    expect(result).toBe(CANONICAL_BIBTEX);
  });

  it("calls getText with the correct bibtex endpoint URL", async () => {
    const getTextSpy = vi.fn().mockResolvedValue(CANONICAL_BIBTEX);
    const ds = makeDataSource(getTextSpy);
    const client = makeClient(ds);
    await client.toBibTeX("2310.06825");
    expect(getTextSpy).toHaveBeenCalledWith(
      "https://arxiv.org/bibtex/2310.06825"
    );
  });

  it("falls back to generateBibTeX when getText throws", async () => {
    const ds = makeDataSource(() =>
      Promise.reject(new Error("network failure"))
    );
    const client = makeClient(ds);
    const result = await client.toBibTeX("2310.06825");
    const expected = generateBibTeX(FIXTURE_PAPER);
    expect(result).toBe(expected);
  });

  it("invokes getPaper with the original id string during fallback", async () => {
    const ds = makeDataSource(() =>
      Promise.reject(new Error("not found"))
    );
    const client = makeClient(ds);
    await client.toBibTeX("2310.06825");
    expect(client.getPaper).toHaveBeenCalledWith("2310.06825");
  });

  it("calls getText with old-style slash preserved in the URL", async () => {
    const getTextSpy = vi.fn().mockResolvedValue(CANONICAL_BIBTEX);
    const ds = makeDataSource(getTextSpy);
    const client = makeClient(ds);
    await client.toBibTeX("cond-mat/0011267");
    expect(getTextSpy).toHaveBeenCalledWith(
      "https://arxiv.org/bibtex/cond-mat/0011267"
    );
  });
});
```

- [ ] **Step 2: Run the test, expect FAIL.** Run: `npx vitest run test/core/client-bibtex.test.ts`. Expected: FAIL — `toBibTeX: implemented in Phase 7` error thrown, confirming the stub is in place and the test correctly exercises it.

- [ ] **Step 3: Replace the toBibTeX stub body in src/core/client.ts.**

First, add the `generateBibTeX` import. Locate the existing imports at the top of `src/core/client.ts`. Add this import (after the existing local imports):

```ts
import { generateBibTeX } from "./bibtex.js";
```

If `bibtexUrl` is not already imported from `"./ids.js"`, add it to that import line. The Phase 4 file imports at minimum `normalizeId`, `absUrl`, `pdfUrl`, `filenameFor` from `"./ids.js"` — add `bibtexUrl` to that list.

Then, replace the stub method body. The exact text to find in `src/core/client.ts`:

```ts
  async toBibTeX(id: string): Promise<string> { throw new Error("toBibTeX: implemented in Phase 7"); }
```

Replace it with:

```ts
  async toBibTeX(id: string): Promise<string> {
    const n = normalizeId(id);
    try {
      return await this.api.getText(bibtexUrl(n));
    } catch {
      const paper = await this.getPaper(id);
      return generateBibTeX(paper);
    }
  }
```

- [ ] **Step 4: Run the test, expect PASS.** Run: `npx vitest run test/core/client-bibtex.test.ts`. Expected: PASS — canonical path returns verbatim string, getText is called with the correct URL (slash preserved for old-style), fallback path invokes `getPaper` and returns `generateBibTeX(paper)`.

- [ ] **Step 5: Run all existing tests together and typecheck.** Run: `npx vitest run`. Expected: all previously passing tests still PASS (no regressions). Run: `npx tsc --noEmit`. Expected: no type errors.

- [ ] **Step 6: Commit.**

```
git add src/core/client.ts test/core/client-bibtex.test.ts && git commit -m "feat(core): implement ArxivClient.toBibTeX with canonical fetch and offline fallback

- Fetches https://arxiv.org/bibtex/{id} via DataSource.getText and returns
  the response verbatim (canonical arXiv BibTeX).
- On any getText failure, falls back to getPaper(id) + generateBibTeX(paper).
- Old-style ids keep the slash in the bibtex URL (bibtexUrl from ids.ts).
- Tests cover canonical path, correct URL construction (incl. old-style slash),
  fallback invocation, and getPaper call-through on failure.
"
```

---

## Phase 8: Expand CLI

<!-- Phase: Expand CLI -->

### Task A: `get` command handler

**Files:**
- Create: `src/cli/commands/get.ts`
- Test: `test/cli/commands/get.test.ts`

**Interfaces:**
- Consumes: `ArxivClient.getPapers(ids: string[]): Promise<Paper[]>` and `ArxivClient.toBibTeX(id: string): Promise<string>` from `src/core/client.ts`; `Paper` from `src/core/types.ts`; `ArxivError`, `exitCodeFor` from `src/core/errors.ts`.
- Produces:
  - `export interface GetFlags { bibtex?: boolean; json?: boolean; quiet?: boolean; verbose?: boolean; }`
  - `export interface GetIo { stdout: (s: string) => void; stderr: (s: string) => void; }`
  - `export function formatGetJson(papers: Paper[], bibtex?: Map<string, string>): string`
  - `export function formatGetHuman(papers: Paper[], bibtex?: Map<string, string>): string`
  - `export async function runGet(client: ArxivClient, ids: string[], opts: GetFlags, io: GetIo): Promise<number>`

- [ ] **Step 1: Write failing tests for `runGet`.** Create `test/cli/commands/get.test.ts` with a stub import resolving but assertions failing.

Create `test/cli/commands/get.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import {
  formatGetJson,
  formatGetHuman,
  runGet,
} from "../../src/cli/commands/get.js";
import type { ArxivClient } from "../../src/core/client.js";
import type { Paper } from "../../src/core/types.js";
import { NotFoundError, NetworkError } from "../../src/core/errors.js";

const paper1: Paper = {
  id: "1706.03762",
  version: 1,
  idWithVersion: "1706.03762v1",
  title: "Attention Is All You Need",
  summary: "We propose the Transformer...",
  authors: [{ name: "Ashish Vaswani" }, { name: "Noam Shazeer" }],
  categories: ["cs.CL", "cs.AI"],
  primaryCategory: "cs.CL",
  published: "2017-06-12T00:00:00Z",
  updated: "2017-06-19T00:00:00Z",
  links: {
    abs: "https://arxiv.org/abs/1706.03762",
    pdf: "https://arxiv.org/pdf/1706.03762",
  },
};

const paper2: Paper = {
  id: "2310.06825",
  title: "Mistral 7B",
  summary: "We introduce Mistral...",
  authors: [{ name: "Albert Jiang" }],
  categories: ["cs.CL"],
  primaryCategory: "cs.CL",
  published: "2023-10-10T00:00:00Z",
  updated: "2023-10-10T00:00:00Z",
  links: {
    abs: "https://arxiv.org/abs/2310.06825",
    pdf: "https://arxiv.org/pdf/2310.06825",
  },
};

function sink() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: {
      stdout: (s: string) => { out.push(s); },
      stderr: (s: string) => { err.push(s); },
    },
  };
}

describe("formatGetJson", () => {
  it("serializes papers array without bibtex when bibtex is not provided", () => {
    const parsed = JSON.parse(formatGetJson([paper1]));
    expect(parsed).toEqual({ papers: [paper1] });
  });

  it("includes bibtex entries keyed by id when provided", () => {
    const bib = new Map([["1706.03762", "@misc{vaswani2017attention,\n  title={...}\n}"]]);
    const parsed = JSON.parse(formatGetJson([paper1], bib));
    expect(parsed.papers[0].bibtex).toBe(bib.get("1706.03762"));
  });
});

describe("formatGetHuman", () => {
  it("renders title, id, authors, category, published for each paper", () => {
    const text = formatGetHuman([paper1, paper2]);
    expect(text).toContain("Attention Is All You Need");
    expect(text).toContain("1706.03762");
    expect(text).toContain("Ashish Vaswani");
    expect(text).toContain("Mistral 7B");
    expect(text).toContain("2310.06825");
  });

  it("appends BibTeX block when bibtex map is provided", () => {
    const bibtex = "@misc{vaswani2017attention,\n  title={Attention}\n}";
    const bib = new Map([["1706.03762", bibtex]]);
    const text = formatGetHuman([paper1], bib);
    expect(text).toContain(bibtex);
  });
});

describe("runGet", () => {
  it("calls client.getPapers and prints JSON in --json mode", async () => {
    const client = {
      getPapers: vi.fn().mockResolvedValue([paper1]),
    } as unknown as ArxivClient;
    const { out, err, io } = sink();
    const code = await runGet(client, ["1706.03762"], { json: true }, io);
    expect(code).toBe(0);
    expect(client.getPapers).toHaveBeenCalledWith(["1706.03762"]);
    const parsed = JSON.parse(out.join(""));
    expect(parsed.papers[0].id).toBe("1706.03762");
    expect(err).toEqual([]);
  });

  it("calls client.getPapers and prints human output by default", async () => {
    const client = {
      getPapers: vi.fn().mockResolvedValue([paper1, paper2]),
    } as unknown as ArxivClient;
    const { out, io } = sink();
    const code = await runGet(client, ["1706.03762", "2310.06825"], {}, io);
    expect(code).toBe(0);
    expect(out.join("")).toContain("Attention Is All You Need");
    expect(out.join("")).toContain("Mistral 7B");
  });

  it("fetches BibTeX for each id and includes it in output when --bibtex is set", async () => {
    const bibtexStr = "@misc{vaswani2017attention}";
    const client = {
      getPapers: vi.fn().mockResolvedValue([paper1]),
      toBibTeX: vi.fn().mockResolvedValue(bibtexStr),
    } as unknown as ArxivClient;
    const { out, io } = sink();
    const code = await runGet(client, ["1706.03762"], { bibtex: true }, io);
    expect(code).toBe(0);
    expect(client.toBibTeX).toHaveBeenCalledWith("1706.03762");
    expect(out.join("")).toContain(bibtexStr);
  });

  it("includes bibtex in JSON output when --bibtex and --json are set", async () => {
    const bibtexStr = "@misc{vaswani2017attention}";
    const client = {
      getPapers: vi.fn().mockResolvedValue([paper1]),
      toBibTeX: vi.fn().mockResolvedValue(bibtexStr),
    } as unknown as ArxivClient;
    const { out, io } = sink();
    const code = await runGet(client, ["1706.03762"], { bibtex: true, json: true }, io);
    expect(code).toBe(0);
    const parsed = JSON.parse(out.join(""));
    expect(parsed.papers[0].bibtex).toBe(bibtexStr);
  });

  it("maps NotFoundError to exit 2 with JSON error envelope when --json", async () => {
    const client = {
      getPapers: vi.fn().mockRejectedValue(new NotFoundError("not found")),
    } as unknown as ArxivClient;
    const { err, io } = sink();
    const code = await runGet(client, ["9999.99999"], { json: true }, io);
    expect(code).toBe(2);
    expect(JSON.parse(err.join(""))).toEqual({
      error: { code: "NOT_FOUND", message: "not found" },
    });
  });

  it("maps NetworkError to exit 4 with plain message when not --json", async () => {
    const client = {
      getPapers: vi.fn().mockRejectedValue(new NetworkError("timeout")),
    } as unknown as ArxivClient;
    const { err, io } = sink();
    const code = await runGet(client, ["1706.03762"], {}, io);
    expect(code).toBe(4);
    expect(err.join("")).toContain("timeout");
  });
});
```

Create the stub `src/cli/commands/get.ts`:

```ts
import type { ArxivClient } from "../../core/client.js";
import type { Paper } from "../../core/types.js";

export interface GetFlags {
  bibtex?: boolean;
  json?: boolean;
  quiet?: boolean;
  verbose?: boolean;
}

export interface GetIo {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
}

export function formatGetJson(_papers: Paper[], _bibtex?: Map<string, string>): string {
  return "{}";
}

export function formatGetHuman(_papers: Paper[], _bibtex?: Map<string, string>): string {
  return "";
}

export async function runGet(
  _client: ArxivClient,
  _ids: string[],
  _opts: GetFlags,
  _io: GetIo,
): Promise<number> {
  return 0;
}
```

Run: `npx vitest run test/cli/commands/get.test.ts` — expect FAIL (stubs return empty/0 but assertions check content and exit codes).

- [ ] **Step 2: Implement `src/cli/commands/get.ts`.** Replace with the full implementation.

```ts
import type { ArxivClient } from "../../core/client.js";
import type { Paper } from "../../core/types.js";
import { ArxivError, exitCodeFor } from "../../core/errors.js";

export interface GetFlags {
  bibtex?: boolean;
  json?: boolean;
  quiet?: boolean;
  verbose?: boolean;
}

export interface GetIo {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
}

function formatAuthors(authors: Paper["authors"]): string {
  if (authors.length === 0) return "Unknown";
  if (authors.length <= 3) return authors.map((a) => a.name).join(", ");
  return `${authors[0].name} et al.`;
}

export function formatGetJson(papers: Paper[], bibtex?: Map<string, string>): string {
  const result = {
    papers: papers.map((p) => {
      if (bibtex && bibtex.has(p.id)) {
        return { ...p, bibtex: bibtex.get(p.id) };
      }
      return p;
    }),
  };
  return JSON.stringify(result, null, 2);
}

export function formatGetHuman(papers: Paper[], bibtex?: Map<string, string>): string {
  const lines: string[] = [];
  for (const p of papers) {
    lines.push(`${p.title}`);
    lines.push(`  ID:         ${p.idWithVersion ?? p.id}`);
    lines.push(`  Authors:    ${formatAuthors(p.authors)}`);
    lines.push(`  Category:   ${p.primaryCategory}`);
    lines.push(`  Published:  ${p.published.slice(0, 10)}`);
    if (p.doi) lines.push(`  DOI:        ${p.doi}`);
    lines.push(`  Abstract:   ${p.summary.slice(0, 200)}${p.summary.length > 200 ? "…" : ""}`);
    if (bibtex && bibtex.has(p.id)) {
      lines.push("");
      lines.push(bibtex.get(p.id)!);
    }
    lines.push("");
  }
  return lines.join("\n");
}

export async function runGet(
  client: ArxivClient,
  ids: string[],
  opts: GetFlags,
  io: GetIo,
): Promise<number> {
  try {
    const papers = await client.getPapers(ids);
    let bibtex: Map<string, string> | undefined;
    if (opts.bibtex) {
      bibtex = new Map<string, string>();
      await Promise.all(
        ids.map(async (id) => {
          try {
            const bib = await (client as ArxivClient).toBibTeX(id);
            bibtex!.set(id, bib);
          } catch {
            // best-effort; do not fail the whole command if one bibtex fetch fails
          }
        }),
      );
    }
    if (opts.json) {
      io.stdout(formatGetJson(papers, bibtex) + "\n");
    } else {
      io.stdout(formatGetHuman(papers, bibtex));
    }
    return 0;
  } catch (err) {
    if (err instanceof ArxivError) {
      const code = exitCodeFor(err);
      if (opts.json) {
        io.stderr(
          JSON.stringify({ error: { code: err.code, message: err.message } }) + "\n",
        );
      } else {
        io.stderr(`Error: ${err.message}\n`);
        if (opts.verbose && err.stack) io.stderr(err.stack + "\n");
      }
      return code;
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (opts.json) {
      io.stderr(JSON.stringify({ error: { code: "GENERIC", message: msg } }) + "\n");
    } else {
      io.stderr(`Error: ${msg}\n`);
    }
    return 1;
  }
}
```

Run: `npx vitest run test/cli/commands/get.test.ts` — expect PASS.

- [ ] **Step 3: Typecheck and commit.**

Run: `npx tsc --noEmit` — expect no errors in the new files.

```
git add src/cli/commands/get.ts test/cli/commands/get.test.ts
git commit -m "feat(cli): add get command with metadata lookup and optional BibTeX"
```

---

### Task B: `read` command handler

**Files:**
- Create: `src/cli/commands/read.ts`
- Test: `test/cli/commands/read.test.ts`

**Interfaces:**
- Consumes: `ArxivClient.getContent(id: string, opts?: ReadOptions): Promise<PaperContent>` from `src/core/client.ts`; `PaperContent`, `ReadOptions` from `src/core/types.ts`; `ArxivError`, `exitCodeFor` from `src/core/errors.ts`; `node:fs/promises` (`writeFile`) for `--out` file writing.
- Produces:
  - `export interface ReadFlags { source?: "auto" | "html" | "pdf"; format?: "markdown" | "text"; section?: string; maxChars?: number; out?: string; json?: boolean; quiet?: boolean; verbose?: boolean; }`
  - `export interface ReadIo { stdout: (s: string) => void; stderr: (s: string) => void; }`
  - `export function buildReadOptions(opts: ReadFlags): ReadOptions`
  - `export function formatReadJson(content: PaperContent): string`
  - `export async function runRead(client: ArxivClient, id: string, opts: ReadFlags, io: ReadIo): Promise<number>`

**Notes:** When `--out <file>` is provided, write the content text to that file (using `fs/promises writeFile`) and print the absolute path to stdout. When not provided, write text to stdout. `nextCursor` is surfaced in the JSON envelope when present; in human mode it is printed to stderr (so callers can iterate). Warnings from `PaperContent.warnings` are always printed to stderr (suppressed by `--quiet`).

- [ ] **Step 1: Write failing tests.** Create `test/cli/commands/read.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildReadOptions,
  formatReadJson,
  runRead,
} from "../../src/cli/commands/read.js";
import type { ArxivClient } from "../../src/core/client.js";
import type { PaperContent } from "../../src/core/types.js";
import { NotFoundError, UnsupportedError } from "../../src/core/errors.js";

const content: PaperContent = {
  id: "1706.03762",
  version: 1,
  source: "html-native",
  format: "markdown",
  title: "Attention Is All You Need",
  abstract: "We propose a new network architecture...",
  sections: [
    { id: "S1", title: "Introduction", level: 1, content: "## Introduction\n\nWe propose..." },
  ],
  text: "## Introduction\n\nWe propose...",
  truncated: false,
};

const contentWithCursor: PaperContent = {
  ...content,
  truncated: true,
  nextCursor: "eyJpZCI6IjE3MDYuMDM3NjIiLCJzZWN0aW9uSW5kZXgiOjF9",
};

function sink() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: {
      stdout: (s: string) => { out.push(s); },
      stderr: (s: string) => { err.push(s); },
    },
  };
}

let tmpDir: string;
beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), "arxiv-read-")); });
afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

describe("buildReadOptions", () => {
  it("maps all flags to ReadOptions", () => {
    const opts = buildReadOptions({
      source: "html",
      format: "text",
      section: "Introduction",
      maxChars: 5000,
    });
    expect(opts).toEqual({
      source: "html",
      format: "text",
      section: "Introduction",
      maxChars: 5000,
    });
  });

  it("omits undefined fields (uses client defaults)", () => {
    const opts = buildReadOptions({});
    expect(opts).toEqual({});
  });
});

describe("formatReadJson", () => {
  it("serializes content including nextCursor when present", () => {
    const parsed = JSON.parse(formatReadJson(contentWithCursor));
    expect(parsed.id).toBe("1706.03762");
    expect(parsed.nextCursor).toBe(contentWithCursor.nextCursor);
    expect(parsed.truncated).toBe(true);
  });

  it("does not include nextCursor key when absent", () => {
    const parsed = JSON.parse(formatReadJson(content));
    expect("nextCursor" in parsed).toBe(false);
  });
});

describe("runRead", () => {
  it("calls client.getContent with mapped options and prints text to stdout", async () => {
    const client = {
      getContent: vi.fn().mockResolvedValue(content),
    } as unknown as ArxivClient;
    const { out, err, io } = sink();
    const code = await runRead(client, "1706.03762", {}, io);
    expect(code).toBe(0);
    expect(client.getContent).toHaveBeenCalledWith("1706.03762", {});
    expect(out.join("")).toContain("## Introduction");
    expect(err).toEqual([]);
  });

  it("emits JSON envelope in --json mode", async () => {
    const client = {
      getContent: vi.fn().mockResolvedValue(content),
    } as unknown as ArxivClient;
    const { out, io } = sink();
    const code = await runRead(client, "1706.03762", { json: true }, io);
    expect(code).toBe(0);
    const parsed = JSON.parse(out.join(""));
    expect(parsed.id).toBe("1706.03762");
    expect(parsed.source).toBe("html-native");
  });

  it("prints nextCursor to stderr in human mode and includes in JSON", async () => {
    const client = {
      getContent: vi.fn().mockResolvedValue(contentWithCursor),
    } as unknown as ArxivClient;
    // human mode: nextCursor to stderr
    const h = sink();
    await runRead(client, "1706.03762", {}, h.io);
    expect(h.err.join("")).toContain(contentWithCursor.nextCursor);

    // json mode: nextCursor in envelope
    const j = sink();
    await runRead(client, "1706.03762", { json: true }, j.io);
    const parsed = JSON.parse(j.out.join(""));
    expect(parsed.nextCursor).toBe(contentWithCursor.nextCursor);
    expect(j.err.join("")).not.toContain(contentWithCursor.nextCursor);
  });

  it("prints warnings to stderr unless --quiet", async () => {
    const withWarnings: PaperContent = { ...content, warnings: ["ar5iv fallback used"] };
    const client = {
      getContent: vi.fn().mockResolvedValue(withWarnings),
    } as unknown as ArxivClient;
    const loud = sink();
    await runRead(client, "1706.03762", {}, loud.io);
    expect(loud.err.join("")).toContain("ar5iv fallback used");

    const quiet = sink();
    await runRead(client, "1706.03762", { quiet: true }, quiet.io);
    expect(quiet.err.join("")).toBe("");
  });

  it("writes text to --out file and prints absolute path to stdout", async () => {
    const client = {
      getContent: vi.fn().mockResolvedValue(content),
    } as unknown as ArxivClient;
    const outFile = join(tmpDir, "paper.md");
    const { out, io } = sink();
    const code = await runRead(client, "1706.03762", { out: outFile }, io);
    expect(code).toBe(0);
    expect(out.join("")).toContain(outFile);
    const written = await readFile(outFile, "utf8");
    expect(written).toContain("## Introduction");
  });

  it("maps NotFoundError to exit 2 with JSON error envelope when --json", async () => {
    const client = {
      getContent: vi.fn().mockRejectedValue(new NotFoundError("paper not found")),
    } as unknown as ArxivClient;
    const { err, io } = sink();
    const code = await runRead(client, "9999.99999", { json: true }, io);
    expect(code).toBe(2);
    expect(JSON.parse(err.join(""))).toEqual({
      error: { code: "NOT_FOUND", message: "paper not found" },
    });
  });

  it("maps UnsupportedError to exit 6", async () => {
    const client = {
      getContent: vi.fn().mockRejectedValue(new UnsupportedError("no browser")),
    } as unknown as ArxivClient;
    const { io } = sink();
    const code = await runRead(client, "1706.03762", {}, io);
    expect(code).toBe(6);
  });
});
```

Create the stub `src/cli/commands/read.ts`:

```ts
import type { ArxivClient } from "../../core/client.js";
import type { PaperContent, ReadOptions } from "../../core/types.js";

export interface ReadFlags {
  source?: "auto" | "html" | "pdf";
  format?: "markdown" | "text";
  section?: string;
  maxChars?: number;
  out?: string;
  json?: boolean;
  quiet?: boolean;
  verbose?: boolean;
}

export interface ReadIo {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
}

export function buildReadOptions(_opts: ReadFlags): ReadOptions {
  return {};
}

export function formatReadJson(_content: PaperContent): string {
  return "{}";
}

export async function runRead(
  _client: ArxivClient,
  _id: string,
  _opts: ReadFlags,
  _io: ReadIo,
): Promise<number> {
  return 0;
}
```

Run: `npx vitest run test/cli/commands/read.test.ts` — expect FAIL.

- [ ] **Step 2: Implement `src/cli/commands/read.ts`.**

```ts
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ArxivClient } from "../../core/client.js";
import type { PaperContent, ReadOptions } from "../../core/types.js";
import { ArxivError, exitCodeFor } from "../../core/errors.js";

export interface ReadFlags {
  source?: "auto" | "html" | "pdf";
  format?: "markdown" | "text";
  section?: string;
  maxChars?: number;
  out?: string;
  json?: boolean;
  quiet?: boolean;
  verbose?: boolean;
}

export interface ReadIo {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
}

export function buildReadOptions(opts: ReadFlags): ReadOptions {
  const o: ReadOptions = {};
  if (opts.source !== undefined) o.source = opts.source;
  if (opts.format !== undefined) o.format = opts.format;
  if (opts.section !== undefined) o.section = opts.section;
  if (opts.maxChars !== undefined) o.maxChars = opts.maxChars;
  return o;
}

export function formatReadJson(content: PaperContent): string {
  return JSON.stringify(content, null, 2);
}

export async function runRead(
  client: ArxivClient,
  id: string,
  opts: ReadFlags,
  io: ReadIo,
): Promise<number> {
  try {
    const readOpts = buildReadOptions(opts);
    const content = await client.getContent(id, readOpts);

    if (!opts.quiet && content.warnings) {
      for (const w of content.warnings) io.stderr(`Warning: ${w}\n`);
    }

    if (opts.json) {
      io.stdout(formatReadJson(content) + "\n");
    } else {
      if (opts.out) {
        const absPath = resolve(opts.out);
        await writeFile(absPath, content.text, "utf8");
        io.stdout(`Saved to ${absPath}\n`);
      } else {
        io.stdout(content.text);
      }
      if (content.nextCursor) {
        io.stderr(`nextCursor: ${content.nextCursor}\n`);
      }
    }
    return 0;
  } catch (err) {
    if (err instanceof ArxivError) {
      const code = exitCodeFor(err);
      if (opts.json) {
        io.stderr(
          JSON.stringify({ error: { code: err.code, message: err.message } }) + "\n",
        );
      } else {
        io.stderr(`Error: ${err.message}\n`);
        if (opts.verbose && err.stack) io.stderr(err.stack + "\n");
      }
      return code;
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (opts.json) {
      io.stderr(JSON.stringify({ error: { code: "GENERIC", message: msg } }) + "\n");
    } else {
      io.stderr(`Error: ${msg}\n`);
    }
    return 1;
  }
}
```

Run: `npx vitest run test/cli/commands/read.test.ts` — expect PASS.

- [ ] **Step 3: Typecheck and commit.**

Run: `npx tsc --noEmit` — expect no errors in the new files.

```
git add src/cli/commands/read.ts test/cli/commands/read.test.ts
git commit -m "feat(cli): add read command with source/format/section/maxChars/--out support"
```

---

### Task C: `recent` command handler

**Files:**
- Create: `src/cli/commands/recent.ts`
- Test: `test/cli/commands/recent.test.ts`

**Interfaces:**
- Consumes: `ArxivClient.recent(category: string, opts?: { maxResults?: number }): Promise<SearchResult>` from `src/core/client.ts`; `SearchResult` from `src/core/types.ts`; `ArxivError`, `exitCodeFor` from `src/core/errors.ts`.
- Produces:
  - `export interface RecentFlags { max?: number; json?: boolean; quiet?: boolean; verbose?: boolean; }`
  - `export interface RecentIo { stdout: (s: string) => void; stderr: (s: string) => void; }`
  - `export function formatRecentJson(result: SearchResult): string`
  - `export function formatRecentHuman(result: SearchResult): string`
  - `export async function runRecent(client: ArxivClient, category: string, opts: RecentFlags, io: RecentIo): Promise<number>`

**Notes:** Human output mirrors `formatSearchHuman` from `search.ts` (same `Found N result(s)` header, numbered list). `hints` go to stderr unless `--quiet`. Reuses the same JSON structure as `SearchResult`.

- [ ] **Step 1: Write failing tests.** Create `test/cli/commands/recent.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import {
  formatRecentJson,
  formatRecentHuman,
  runRecent,
} from "../../src/cli/commands/recent.js";
import type { ArxivClient } from "../../src/core/client.js";
import type { SearchResult } from "../../src/core/types.js";
import { RateLimitedError } from "../../src/core/errors.js";

const result: SearchResult = {
  total: 2,
  start: 0,
  count: 2,
  papers: [
    {
      id: "2406.00001",
      title: "New Physics Paper",
      summary: "Abstract...",
      authors: [{ name: "Alice Scientist" }],
      categories: ["hep-th"],
      primaryCategory: "hep-th",
      published: "2024-06-01T00:00:00Z",
      updated: "2024-06-01T00:00:00Z",
      links: {
        abs: "https://arxiv.org/abs/2406.00001",
        pdf: "https://arxiv.org/pdf/2406.00001",
      },
    },
    {
      id: "2406.00002",
      title: "Another Physics Paper",
      summary: "Abstract...",
      authors: [{ name: "Bob Researcher" }, { name: "Carol Postdoc" }, { name: "Dave Prof" }, { name: "Eve Grad" }],
      categories: ["hep-th", "gr-qc"],
      primaryCategory: "hep-th",
      published: "2024-06-01T00:00:00Z",
      updated: "2024-06-01T00:00:00Z",
      links: {
        abs: "https://arxiv.org/abs/2406.00002",
        pdf: "https://arxiv.org/pdf/2406.00002",
      },
    },
  ],
};

function sink() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: {
      stdout: (s: string) => { out.push(s); },
      stderr: (s: string) => { err.push(s); },
    },
  };
}

describe("formatRecentJson", () => {
  it("serializes the full SearchResult", () => {
    const parsed = JSON.parse(formatRecentJson(result));
    expect(parsed).toEqual(result);
  });
});

describe("formatRecentHuman", () => {
  it("renders a header and numbered list with id, author, category, date", () => {
    const text = formatRecentHuman(result);
    expect(text).toContain("Found 2 result(s) (showing 1-2)");
    expect(text).toContain("1. New Physics Paper");
    expect(text).toContain("2406.00001 | Alice Scientist | hep-th | 2024-06-01");
    expect(text).toContain("2. Another Physics Paper");
    expect(text).toContain("2406.00002 | Bob Researcher et al. | hep-th | 2024-06-01");
    expect(text.endsWith("\n")).toBe(true);
  });
});

describe("runRecent", () => {
  it("calls client.recent with category and maxResults, prints JSON in --json mode", async () => {
    const client = { recent: vi.fn().mockResolvedValue(result) } as unknown as ArxivClient;
    const { out, err, io } = sink();
    const code = await runRecent(client, "hep-th", { json: true, max: 10 }, io);
    expect(code).toBe(0);
    expect(client.recent).toHaveBeenCalledWith("hep-th", { maxResults: 10 });
    expect(JSON.parse(out.join(""))).toEqual(result);
    expect(err).toEqual([]);
  });

  it("prints human output by default and omits maxResults when not specified", async () => {
    const client = { recent: vi.fn().mockResolvedValue(result) } as unknown as ArxivClient;
    const { out, io } = sink();
    const code = await runRecent(client, "cs.CL", {}, io);
    expect(code).toBe(0);
    expect(client.recent).toHaveBeenCalledWith("cs.CL", {});
    expect(out.join("")).toContain("Found 2 result(s)");
  });

  it("sends hints to stderr unless --quiet", async () => {
    const hinted: SearchResult = { ...result, hints: ["too many results — narrow"] };
    const client = { recent: vi.fn().mockResolvedValue(hinted) } as unknown as ArxivClient;
    const loud = sink();
    await runRecent(client, "cs.CL", {}, loud.io);
    expect(loud.err.join("")).toContain("too many results");

    const quiet = sink();
    await runRecent(client, "cs.CL", { quiet: true }, quiet.io);
    expect(quiet.err.join("")).toBe("");
  });

  it("maps RateLimitedError to exit 3 and emits JSON error envelope when --json", async () => {
    const client = {
      recent: vi.fn().mockRejectedValue(new RateLimitedError("rate limited")),
    } as unknown as ArxivClient;
    const { err, io } = sink();
    const code = await runRecent(client, "cs.CL", { json: true }, io);
    expect(code).toBe(3);
    expect(JSON.parse(err.join(""))).toEqual({
      error: { code: "RATE_LIMITED", message: "rate limited" },
    });
  });
});
```

Create the stub `src/cli/commands/recent.ts`:

```ts
import type { ArxivClient } from "../../core/client.js";
import type { SearchResult } from "../../core/types.js";

export interface RecentFlags {
  max?: number;
  json?: boolean;
  quiet?: boolean;
  verbose?: boolean;
}

export interface RecentIo {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
}

export function formatRecentJson(_result: SearchResult): string {
  return "{}";
}

export function formatRecentHuman(_result: SearchResult): string {
  return "";
}

export async function runRecent(
  _client: ArxivClient,
  _category: string,
  _opts: RecentFlags,
  _io: RecentIo,
): Promise<number> {
  return 0;
}
```

Run: `npx vitest run test/cli/commands/recent.test.ts` — expect FAIL.

- [ ] **Step 2: Implement `src/cli/commands/recent.ts`.**

```ts
import type { ArxivClient } from "../../core/client.js";
import type { SearchResult } from "../../core/types.js";
import { ArxivError, exitCodeFor } from "../../core/errors.js";

export interface RecentFlags {
  max?: number;
  json?: boolean;
  quiet?: boolean;
  verbose?: boolean;
}

export interface RecentIo {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
}

function formatAuthors(authors: SearchResult["papers"][number]["authors"]): string {
  if (authors.length === 0) return "Unknown";
  if (authors.length <= 3) return authors.map((a) => a.name).join(", ");
  return `${authors[0].name} et al.`;
}

export function formatRecentJson(result: SearchResult): string {
  return JSON.stringify(result, null, 2);
}

export function formatRecentHuman(result: SearchResult): string {
  const lines: string[] = [];
  lines.push(
    `Found ${result.total} result(s) (showing ${result.start + 1}-${result.start + result.count})`,
  );
  lines.push("");
  result.papers.forEach((p, i) => {
    lines.push(`${i + 1}. ${p.title}`);
    lines.push(
      `   ${p.id} | ${formatAuthors(p.authors)} | ${p.primaryCategory} | ${p.published.slice(0, 10)}`,
    );
  });
  return lines.join("\n") + "\n";
}

export async function runRecent(
  client: ArxivClient,
  category: string,
  opts: RecentFlags,
  io: RecentIo,
): Promise<number> {
  try {
    const recentOpts: { maxResults?: number } = {};
    if (opts.max !== undefined) recentOpts.maxResults = opts.max;
    const result = await client.recent(category, recentOpts);
    if (opts.json) {
      io.stdout(formatRecentJson(result) + "\n");
    } else {
      io.stdout(formatRecentHuman(result));
    }
    if (!opts.quiet && result.hints) {
      for (const h of result.hints) io.stderr(h + "\n");
    }
    return 0;
  } catch (err) {
    if (err instanceof ArxivError) {
      const code = exitCodeFor(err);
      if (opts.json) {
        io.stderr(
          JSON.stringify({ error: { code: err.code, message: err.message } }) + "\n",
        );
      } else {
        io.stderr(`Error: ${err.message}\n`);
        if (opts.verbose && err.stack) io.stderr(err.stack + "\n");
      }
      return code;
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (opts.json) {
      io.stderr(JSON.stringify({ error: { code: "GENERIC", message: msg } }) + "\n");
    } else {
      io.stderr(`Error: ${msg}\n`);
    }
    return 1;
  }
}
```

Run: `npx vitest run test/cli/commands/recent.test.ts` — expect PASS.

- [ ] **Step 3: Typecheck and commit.**

Run: `npx tsc --noEmit` — expect no errors in the new files.

```
git add src/cli/commands/recent.ts test/cli/commands/recent.test.ts
git commit -m "feat(cli): add recent command for latest papers in a category"
```

---

### Task D: `download` command handler

**Files:**
- Create: `src/cli/commands/download.ts`
- Test: `test/cli/commands/download.test.ts`

**Interfaces:**
- Consumes: `ArxivClient.download(id: string, opts?: DownloadOptions): Promise<{ path: string; bytes: number }>` from `src/core/client.ts`; `DownloadOptions` from `src/core/types.js`; `ArxivError`, `exitCodeFor` from `src/core/errors.ts`.
- Produces:
  - `export interface DownloadFlags { out?: string; json?: boolean; quiet?: boolean; verbose?: boolean; }`
  - `export interface DownloadIo { stdout: (s: string) => void; stderr: (s: string) => void; }`
  - `export async function runDownload(client: ArxivClient, ids: string[], opts: DownloadFlags, io: DownloadIo): Promise<number>`

**Spec §12 behavior:** loop `client.download(id, { dir: opts.out })` per id; on success print the ABSOLUTE path to stdout; on failure print to stderr and continue; after processing all ids, return 0 if all succeeded, or the `exitCodeFor` code of the FIRST failure (spec §12 "exit code = the first failure's code"). `--json` flag: on success per-id emit `{ "id": ..., "path": ..., "bytes": ... }` JSON line; on error per-id emit to stderr as `{ "error": { "id": ..., "code": ..., "message": ... } }`.

- [ ] **Step 1: Write failing tests.** Create `test/cli/commands/download.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { runDownload } from "../../src/cli/commands/download.js";
import type { ArxivClient } from "../../src/core/client.js";
import { NotFoundError, NetworkError } from "../../src/core/errors.js";

function sink() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: {
      stdout: (s: string) => { out.push(s); },
      stderr: (s: string) => { err.push(s); },
    },
  };
}

describe("runDownload", () => {
  it("calls client.download for each id and prints the absolute path to stdout", async () => {
    const client = {
      download: vi.fn()
        .mockResolvedValueOnce({ path: "/home/user/papers/1706.03762v1.pdf", bytes: 1024 })
        .mockResolvedValueOnce({ path: "/home/user/papers/2310.06825.pdf", bytes: 2048 }),
    } as unknown as ArxivClient;
    const { out, err, io } = sink();
    const code = await runDownload(client, ["1706.03762", "2310.06825"], {}, io);
    expect(code).toBe(0);
    expect(client.download).toHaveBeenCalledTimes(2);
    expect(client.download).toHaveBeenCalledWith("1706.03762", {});
    expect(client.download).toHaveBeenCalledWith("2310.06825", {});
    expect(out.join("")).toContain("/home/user/papers/1706.03762v1.pdf");
    expect(out.join("")).toContain("/home/user/papers/2310.06825.pdf");
    expect(err).toEqual([]);
  });

  it("passes --out dir to client.download as dir option", async () => {
    const client = {
      download: vi.fn().mockResolvedValue({ path: "/custom/dir/1706.03762.pdf", bytes: 512 }),
    } as unknown as ArxivClient;
    const { io } = sink();
    await runDownload(client, ["1706.03762"], { out: "/custom/dir" }, io);
    expect(client.download).toHaveBeenCalledWith("1706.03762", { dir: "/custom/dir" });
  });

  it("emits JSON lines to stdout in --json mode", async () => {
    const client = {
      download: vi.fn().mockResolvedValue({ path: "/papers/1706.03762.pdf", bytes: 100 }),
    } as unknown as ArxivClient;
    const { out, io } = sink();
    const code = await runDownload(client, ["1706.03762"], { json: true }, io);
    expect(code).toBe(0);
    const parsed = JSON.parse(out.join(""));
    expect(parsed).toEqual({ id: "1706.03762", path: "/papers/1706.03762.pdf", bytes: 100 });
  });

  it("continues on error, reports failed id to stderr, and returns first failure exit code", async () => {
    const client = {
      download: vi.fn()
        .mockRejectedValueOnce(new NotFoundError("1706.03762 not found"))
        .mockResolvedValueOnce({ path: "/papers/2310.06825.pdf", bytes: 512 })
        .mockRejectedValueOnce(new NetworkError("timeout")),
    } as unknown as ArxivClient;
    const { out, err, io } = sink();
    const code = await runDownload(
      client,
      ["1706.03762", "2310.06825", "9999.99999"],
      {},
      io,
    );
    // first failure was NotFoundError → exit code 2
    expect(code).toBe(2);
    // second id succeeded
    expect(out.join("")).toContain("/papers/2310.06825.pdf");
    // both failed ids reported to stderr
    expect(err.join("")).toContain("1706.03762");
    expect(err.join("")).toContain("9999.99999");
  });

  it("continues on error in --json mode, emits error JSON to stderr and success JSON to stdout", async () => {
    const client = {
      download: vi.fn()
        .mockRejectedValueOnce(new NotFoundError("not found"))
        .mockResolvedValueOnce({ path: "/papers/2310.06825.pdf", bytes: 512 }),
    } as unknown as ArxivClient;
    const { out, err, io } = sink();
    const code = await runDownload(
      client,
      ["1706.03762", "2310.06825"],
      { json: true },
      io,
    );
    expect(code).toBe(2); // first failure NotFoundError
    const successJson = JSON.parse(out.join(""));
    expect(successJson.path).toBe("/papers/2310.06825.pdf");
    const errorJson = JSON.parse(err.join(""));
    expect(errorJson.error.id).toBe("1706.03762");
    expect(errorJson.error.code).toBe("NOT_FOUND");
  });

  it("returns 0 when all ids succeed", async () => {
    const client = {
      download: vi.fn().mockResolvedValue({ path: "/p/1706.03762.pdf", bytes: 1 }),
    } as unknown as ArxivClient;
    const { io } = sink();
    expect(await runDownload(client, ["1706.03762"], {}, io)).toBe(0);
  });
});
```

Create the stub `src/cli/commands/download.ts`:

```ts
import type { ArxivClient } from "../../core/client.js";

export interface DownloadFlags {
  out?: string;
  json?: boolean;
  quiet?: boolean;
  verbose?: boolean;
}

export interface DownloadIo {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
}

export async function runDownload(
  _client: ArxivClient,
  _ids: string[],
  _opts: DownloadFlags,
  _io: DownloadIo,
): Promise<number> {
  return 0;
}
```

Run: `npx vitest run test/cli/commands/download.test.ts` — expect FAIL.

- [ ] **Step 2: Implement `src/cli/commands/download.ts`.**

```ts
import type { ArxivClient } from "../../core/client.js";
import type { DownloadOptions } from "../../core/types.js";
import { ArxivError, exitCodeFor } from "../../core/errors.js";

export interface DownloadFlags {
  out?: string;
  json?: boolean;
  quiet?: boolean;
  verbose?: boolean;
}

export interface DownloadIo {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
}

export async function runDownload(
  client: ArxivClient,
  ids: string[],
  opts: DownloadFlags,
  io: DownloadIo,
): Promise<number> {
  let firstFailureCode: number | null = null;

  for (const id of ids) {
    const dlOpts: DownloadOptions = {};
    if (opts.out) dlOpts.dir = opts.out;

    try {
      const { path, bytes } = await client.download(id, dlOpts);
      if (opts.json) {
        io.stdout(JSON.stringify({ id, path, bytes }) + "\n");
      } else {
        io.stdout(path + "\n");
      }
    } catch (err) {
      const code = err instanceof ArxivError ? exitCodeFor(err) : 1;
      if (firstFailureCode === null) firstFailureCode = code;

      if (opts.json) {
        const errCode = err instanceof ArxivError ? err.code : "GENERIC";
        const errMsg = err instanceof Error ? err.message : String(err);
        io.stderr(
          JSON.stringify({ error: { id, code: errCode, message: errMsg } }) + "\n",
        );
      } else {
        const errMsg = err instanceof Error ? err.message : String(err);
        io.stderr(`Error downloading ${id}: ${errMsg}\n`);
        if (opts.verbose && err instanceof Error && err.stack) {
          io.stderr(err.stack + "\n");
        }
      }
    }
  }

  return firstFailureCode ?? 0;
}
```

Run: `npx vitest run test/cli/commands/download.test.ts` — expect PASS.

- [ ] **Step 3: Typecheck and commit.**

Run: `npx tsc --noEmit` — expect no errors in the new files.

```
git add src/cli/commands/download.ts test/cli/commands/download.test.ts
git commit -m "feat(cli): add download command with multi-ID loop, continue-on-error, and first-failure exit code"
```

---

### Task E: `cache` command handler

**Files:**
- Create: `src/cli/commands/cache.ts`
- Test: `test/cli/commands/cache.test.ts`

**Interfaces:**

**Design choice:** `cache` does not use `ArxivClient`. It uses `resolveConfig(globalFlags)` directly to locate `cacheDir`, then calls `fs.rm(cacheDir, { recursive: true, force: true })` for `clear` and logs the path for `path`. This keeps it consistent with how `createProgram` builds the client — the same `GlobalFlags` that would be passed to `defaultClientFactory` are passed to `runCache`; it calls `resolveConfig` with the same subset (`noCache`, `cacheDir`, `browserFallback` are irrelevant for a path lookup, but `cacheDir` from the flag is used if set). This avoids constructing a full `ArxivClient` for a filesystem-only operation (spec §13: "Cache maintenance is intentionally CLI/ops-only").

- Consumes: `resolveConfig(overrides?: Partial<ArxivConfig>): ArxivConfig` from `src/core/config.ts`; `ArxivConfig` from `src/core/types.ts`; `node:fs/promises` (`rm`); `node:fs` (`existsSync`).
- Produces:
  - `export type CacheAction = "clear" | "path"`
  - `export interface CacheFlags { cacheDir?: string; }`
  - `export interface CacheIo { stdout: (s: string) => void; stderr: (s: string) => void; }`
  - `export async function runCache(action: CacheAction, opts: CacheFlags, io: CacheIo): Promise<number>`

- [ ] **Step 1: Write failing tests.** Create `test/cli/commands/cache.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runCache } from "../../src/cli/commands/cache.js";

function sink() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: {
      stdout: (s: string) => { out.push(s); },
      stderr: (s: string) => { err.push(s); },
    },
  };
}

let tmpDir: string;
beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "arxiv-cache-cmd-"));
});
afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("runCache path", () => {
  it("prints the cache directory path to stdout", async () => {
    const { out, io } = sink();
    const code = await runCache("path", { cacheDir: tmpDir }, io);
    expect(code).toBe(0);
    expect(out.join("").trim()).toBe(tmpDir);
  });
});

describe("runCache clear", () => {
  it("removes all files in the cache directory and returns 0", async () => {
    // populate the cache dir with some files
    const subDir = join(tmpDir, "entries");
    mkdirSync(subDir);
    writeFileSync(join(subDir, "abc.json"), "{}");
    writeFileSync(join(tmpDir, "xyz.json"), "{}");

    const { out, io } = sink();
    const code = await runCache("clear", { cacheDir: tmpDir }, io);
    expect(code).toBe(0);
    // the cache dir itself should no longer exist (rm recursive) or be empty;
    // either is acceptable — the spec just says "empties it"
    expect(existsSync(join(subDir, "abc.json"))).toBe(false);
    expect(out.join("")).toContain(tmpDir);
  });

  it("returns 0 when the cache directory does not exist (no error)", async () => {
    const nonExistent = join(tmpDir, "does-not-exist");
    const { io } = sink();
    const code = await runCache("clear", { cacheDir: nonExistent }, io);
    expect(code).toBe(0);
  });

  it("returns 1 and writes to stderr when an unknown action is provided", async () => {
    const { err, io } = sink();
    // @ts-expect-error intentional bad action for test
    const code = await runCache("bogus", { cacheDir: tmpDir }, io);
    expect(code).toBe(1);
    expect(err.join("")).toContain("bogus");
  });
});
```

Create the stub `src/cli/commands/cache.ts`:

```ts
export type CacheAction = "clear" | "path";

export interface CacheFlags {
  cacheDir?: string;
}

export interface CacheIo {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
}

export async function runCache(
  _action: CacheAction,
  _opts: CacheFlags,
  _io: CacheIo,
): Promise<number> {
  return 0;
}
```

Run: `npx vitest run test/cli/commands/cache.test.ts` — expect FAIL (stub returns 0 always; unknown-action test expects 1; path test expects output; clear test expects files removed).

- [ ] **Step 2: Implement `src/cli/commands/cache.ts`.**

```ts
import { rm } from "node:fs/promises";
import { resolveConfig } from "../../core/config.js";

export type CacheAction = "clear" | "path";

export interface CacheFlags {
  cacheDir?: string;
}

export interface CacheIo {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
}

export async function runCache(
  action: CacheAction,
  opts: CacheFlags,
  io: CacheIo,
): Promise<number> {
  // Resolve config only to discover cacheDir; a cacheDir override in flags wins.
  const cfg = resolveConfig(opts.cacheDir ? { cacheDir: opts.cacheDir } : undefined);
  const cacheDir = cfg.cacheDir;

  if (action === "path") {
    io.stdout(cacheDir + "\n");
    return 0;
  }

  if (action === "clear") {
    try {
      await rm(cacheDir, { recursive: true, force: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      io.stderr(`Error clearing cache: ${msg}\n`);
      return 1;
    }
    io.stdout(`Cache cleared: ${cacheDir}\n`);
    return 0;
  }

  io.stderr(`Unknown cache action: ${String(action)}. Use 'clear' or 'path'.\n`);
  return 1;
}
```

Run: `npx vitest run test/cli/commands/cache.test.ts` — expect PASS.

- [ ] **Step 3: Typecheck and commit.**

Run: `npx tsc --noEmit` — expect no errors in the new files.

```
git add src/cli/commands/cache.ts test/cli/commands/cache.test.ts
git commit -m "feat(cli): add cache command (path/clear) using resolveConfig for cacheDir"
```

---

### Task F: Register all commands in `src/cli/index.ts`

**Files:**
- Modify: `src/cli/index.ts`
- Modify: `test/cli/index.test.ts`

**Interfaces:**
- Consumes: `runGet`, `GetFlags` from `./commands/get.js`; `runRead`, `ReadFlags` from `./commands/read.js`; `runRecent`, `RecentFlags` from `./commands/recent.js`; `runDownload`, `DownloadFlags` from `./commands/download.js`; `runCache`, `CacheAction` from `./commands/cache.js`; existing `GlobalFlags`, `CliDeps`, `createProgram`, `run`, `defaultClientFactory` — no signature changes.
- Changes to `src/cli/index.ts`: import the five new `run*` functions; add five new `program.command(…)` blocks inside `createProgram`, each with its commander `.option()`/`.addOption()` declarations and `.action()` handler wiring the global-flag-derived client (same `mergeGlobal` pattern as `search`). The `cache` command receives `action` as its first positional argument (`<action>` i.e. `clear|path`) and does NOT build a client — it passes `{ cacheDir: globalFlags.cacheDir }` directly to `runCache`.

**Note on `createProgram` test:** add an assertion that all six command names (`search`, `get`, `read`, `download`, `recent`, `cache`) are present in `program.commands`. Add targeted integration-style tests for each new command verifying the happy path and global flag propagation (one test per command).

- [ ] **Step 1: Add assertions for the new commands to `test/cli/index.test.ts`.** Append to the existing `describe("cli index")` block (do not replace the existing tests):

```ts
// --- additions to test/cli/index.test.ts ---

import {
  NotFoundError as _NotFoundError,
  NetworkError as _NetworkError,
} from "../../src/core/errors.js";

// Appended inside describe("cli index") block:

it("createProgram registers all six commands", () => {
  const program = createProgram();
  const names = program.commands.map((c) => c.name());
  expect(names).toContain("search");
  expect(names).toContain("get");
  expect(names).toContain("read");
  expect(names).toContain("recent");
  expect(names).toContain("download");
  expect(names).toContain("cache");
});

it("get command calls getPapers and prints JSON", async () => {
  const mockClient = {
    getPapers: vi.fn().mockResolvedValue([paper]),
  } as unknown as ArxivClient;
  const out = sink();
  const err = sink();
  const code = await run(["get", "1706.03762", "--json"], {
    createClient: () => mockClient,
    stdout: out.io,
    stderr: err.io,
  });
  expect(code).toBe(0);
  expect(mockClient.getPapers).toHaveBeenCalledWith(["1706.03762"]);
  const parsed = JSON.parse(out.buf.join(""));
  expect(parsed.papers[0].id).toBe("1706.03762");
});

it("read command calls getContent and streams text to stdout", async () => {
  const content = {
    id: "1706.03762",
    version: 1,
    source: "html-native" as const,
    format: "markdown" as const,
    title: "Attention Is All You Need",
    sections: [{ id: "S1", title: "Introduction", level: 1, content: "## Intro" }],
    text: "## Introduction\n\nWe propose...",
    truncated: false,
  };
  const mockClient = {
    getContent: vi.fn().mockResolvedValue(content),
  } as unknown as ArxivClient;
  const out = sink();
  const code = await run(["read", "1706.03762"], {
    createClient: () => mockClient,
    stdout: out.io,
    stderr: sink().io,
  });
  expect(code).toBe(0);
  expect(mockClient.getContent).toHaveBeenCalledWith("1706.03762", {});
  expect(out.buf.join("")).toContain("## Introduction");
});

it("recent command calls client.recent with category and prints JSON", async () => {
  const recentResult: SearchResult = { total: 1, start: 0, count: 1, papers: [paper] };
  const mockClient = {
    recent: vi.fn().mockResolvedValue(recentResult),
  } as unknown as ArxivClient;
  const out = sink();
  const code = await run(["recent", "cs.CL", "--json"], {
    createClient: () => mockClient,
    stdout: out.io,
    stderr: sink().io,
  });
  expect(code).toBe(0);
  expect(mockClient.recent).toHaveBeenCalledWith("cs.CL", {});
  expect(JSON.parse(out.buf.join(""))).toEqual(recentResult);
});

it("download command calls client.download and prints paths", async () => {
  const mockClient = {
    download: vi.fn().mockResolvedValue({ path: "/papers/1706.03762v1.pdf", bytes: 1024 }),
  } as unknown as ArxivClient;
  const out = sink();
  const code = await run(["download", "1706.03762"], {
    createClient: () => mockClient,
    stdout: out.io,
    stderr: sink().io,
  });
  expect(code).toBe(0);
  expect(mockClient.download).toHaveBeenCalledWith("1706.03762", {});
  expect(out.buf.join("")).toContain("/papers/1706.03762v1.pdf");
});

it("cache path command prints the cache dir without creating a client", async () => {
  // createClient should NOT be called for cache commands
  const createClient = vi.fn().mockReturnValue({ getPapers: vi.fn() } as unknown as ArxivClient);
  const out = sink();
  const code = await run(["--cache-dir", "/tmp/testcache", "cache", "path"], {
    createClient,
    stdout: out.io,
    stderr: sink().io,
  });
  expect(code).toBe(0);
  expect(out.buf.join("").trim()).toBe("/tmp/testcache");
  expect(createClient).not.toHaveBeenCalled();
});
```

Run: `npx vitest run test/cli/index.test.ts` — expect FAIL (new commands not yet registered; `program.commands` missing `get/read/recent/download/cache`).

- [ ] **Step 2: Update `src/cli/index.ts` to import and register the five new commands.** The additions are:
  1. New imports at the top.
  2. Five new command blocks inside `createProgram`, before `return program`.
  3. No changes to existing `GlobalFlags`, `CliDeps`, `Stdio`, `defaultClientFactory`, `run` signatures.

Replace `src/cli/index.ts` with:

```ts
#!/usr/bin/env node
import { Command, CommanderError, Option } from "commander";
import { ArxivClient } from "../core/client.js";
import type { ArxivConfig } from "../core/types.js";
import { runSearch } from "./commands/search.js";
import type { SearchFlags } from "./commands/search.js";
import { runGet } from "./commands/get.js";
import type { GetFlags } from "./commands/get.js";
import { runRead } from "./commands/read.js";
import type { ReadFlags } from "./commands/read.js";
import { runRecent } from "./commands/recent.js";
import type { RecentFlags } from "./commands/recent.js";
import { runDownload } from "./commands/download.js";
import type { DownloadFlags } from "./commands/download.js";
import { runCache } from "./commands/cache.js";
import type { CacheAction } from "./commands/cache.js";

export const VERSION = "0.1.0";

export type Stdio = { write(chunk: string): boolean };

export interface GlobalFlags {
  noCache?: boolean;
  cacheDir?: string;
  browser?: boolean;
  json?: boolean;
  quiet?: boolean;
  verbose?: boolean;
}

export interface CliDeps {
  createClient?: (flags: GlobalFlags) => ArxivClient;
  stdout?: Stdio;
  stderr?: Stdio;
  exit?: (code: number) => void;
}

export function defaultClientFactory(flags: GlobalFlags): ArxivClient {
  const overrides: Partial<ArxivConfig> = {};
  if (flags.noCache) overrides.noCache = true;
  if (flags.cacheDir) overrides.cacheDir = flags.cacheDir;
  if (flags.browser) overrides.browserFallback = true;
  return new ArxivClient(overrides);
}

type RawOpts = Record<string, unknown>;

function mergeGlobal(a: RawOpts, b: RawOpts): GlobalFlags {
  return {
    noCache: a.cache === false || b.cache === false ? true : undefined,
    browser: a.browser === true || b.browser === true ? true : undefined,
    cacheDir: (b.cacheDir as string | undefined) ?? (a.cacheDir as string | undefined),
    json: (b.json as boolean | undefined) ?? (a.json as boolean | undefined),
    quiet: (b.quiet as boolean | undefined) ?? (a.quiet as boolean | undefined),
    verbose: (b.verbose as boolean | undefined) ?? (a.verbose as boolean | undefined),
  };
}

function addCommonOptions(cmd: Command): void {
  cmd.option("--json", "Output JSON (scripting-friendly)");
  cmd.option("--no-cache", "Bypass the cache for this invocation");
  cmd.option("--cache-dir <dir>", "Cache directory");
  cmd.option("--browser", "Enable the browser fallback");
  cmd.option("--quiet", "Suppress non-essential stderr output (hints)");
  cmd.option("--verbose", "Print error stacks on failure");
}

function commanderExitCode(e: unknown): number {
  if (e instanceof CommanderError) return e.exitCode;
  return 1;
}

export function createProgram(deps: CliDeps = {}): Command {
  const createClient = deps.createClient ?? defaultClientFactory;
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const exit = deps.exit ?? ((c: number) => {
    process.exitCode = c;
  });
  const io = {
    stdout: (s: string) => stdout.write(s),
    stderr: (s: string) => stderr.write(s),
  };

  const program = new Command();
  program
    .name("arxiv")
    .description("Search, read, and download arXiv papers")
    .version(VERSION);
  addCommonOptions(program);
  program.exitOverride();

  // --- search ---
  const search = program.command("search [query]");
  search.description("Search arXiv papers");
  addCommonOptions(search);
  search.option("--author <name>", "Filter by author");
  search.option("--category <cat>", "Filter by category");
  search.option("--title <text>", "Filter by title");
  search.option("--abstract <text>", "Filter by abstract");
  search.addOption(
    new Option("--sort <field>", "Sort by")
      .default("relevance")
      .choices(["relevance", "submitted", "updated"]),
  );
  search.addOption(
    new Option("--order <dir>", "Sort order").default("descending").choices(["asc", "desc"]),
  );
  search.option("--max <n>", "Maximum results", (v: string) => Number(v), 25);
  search.option("--start <n>", "Start offset", (v: string) => Number(v), 0);

  search.action(async function (query: string | undefined, opts: RawOpts) {
    const globalFlags = mergeGlobal(program.opts(), opts);
    const client = createClient(globalFlags);
    const flags: SearchFlags = {
      author: opts.author as string | undefined,
      category: opts.category as string | undefined,
      title: opts.title as string | undefined,
      abstract: opts.abstract as string | undefined,
      sort: opts.sort as SearchFlags["sort"],
      order: opts.order as SearchFlags["order"],
      max: opts.max as number | undefined,
      start: opts.start as number | undefined,
      json: globalFlags.json,
      quiet: globalFlags.quiet,
      verbose: globalFlags.verbose,
    };
    const code = await runSearch(client, query, flags, io);
    exit(code);
  });

  // --- get ---
  const get = program.command("get <id...>");
  get.description("Fetch metadata for one or more arXiv IDs");
  addCommonOptions(get);
  get.option("--bibtex", "Also fetch BibTeX for each ID");

  get.action(async function (ids: string[], opts: RawOpts) {
    const globalFlags = mergeGlobal(program.opts(), opts);
    const client = createClient(globalFlags);
    const flags: GetFlags = {
      bibtex: opts.bibtex as boolean | undefined,
      json: globalFlags.json,
      quiet: globalFlags.quiet,
      verbose: globalFlags.verbose,
    };
    const code = await runGet(client, ids, flags, io);
    exit(code);
  });

  // --- read ---
  const read = program.command("read <id>");
  read.description("Read the full text of an arXiv paper");
  addCommonOptions(read);
  read.addOption(
    new Option("--source <src>", "Content source")
      .default("auto")
      .choices(["auto", "html", "pdf"]),
  );
  read.addOption(
    new Option("--format <fmt>", "Output format")
      .default("markdown")
      .choices(["markdown", "text"]),
  );
  read.option("--section <name>", "Return a single named section");
  read.option("--max-chars <n>", "Soft chunk character target", (v: string) => Number(v));
  read.option("--out <file>", "Write output to a file instead of stdout");

  read.action(async function (id: string, opts: RawOpts) {
    const globalFlags = mergeGlobal(program.opts(), opts);
    const client = createClient(globalFlags);
    const flags: ReadFlags = {
      source: opts.source as ReadFlags["source"],
      format: opts.format as ReadFlags["format"],
      section: opts.section as string | undefined,
      maxChars: opts.maxChars as number | undefined,
      out: opts.out as string | undefined,
      json: globalFlags.json,
      quiet: globalFlags.quiet,
      verbose: globalFlags.verbose,
    };
    const code = await runRead(client, id, flags, io);
    exit(code);
  });

  // --- recent ---
  const recent = program.command("recent <category>");
  recent.description("List the most recent papers in an arXiv category");
  addCommonOptions(recent);
  recent.option("--max <n>", "Maximum results", (v: string) => Number(v));

  recent.action(async function (category: string, opts: RawOpts) {
    const globalFlags = mergeGlobal(program.opts(), opts);
    const client = createClient(globalFlags);
    const flags: RecentFlags = {
      max: opts.max as number | undefined,
      json: globalFlags.json,
      quiet: globalFlags.quiet,
      verbose: globalFlags.verbose,
    };
    const code = await runRecent(client, category, flags, io);
    exit(code);
  });

  // --- download ---
  const download = program.command("download <id...>");
  download.description("Download PDF(s) for one or more arXiv IDs");
  addCommonOptions(download);
  download.option("--out <dir>", "Directory to save PDFs (default: configured downloads dir)");

  download.action(async function (ids: string[], opts: RawOpts) {
    const globalFlags = mergeGlobal(program.opts(), opts);
    const client = createClient(globalFlags);
    const flags: DownloadFlags = {
      out: opts.out as string | undefined,
      json: globalFlags.json,
      quiet: globalFlags.quiet,
      verbose: globalFlags.verbose,
    };
    const code = await runDownload(client, ids, flags, io);
    exit(code);
  });

  // --- cache ---
  // The cache command does NOT construct an ArxivClient; it calls runCache with
  // the cacheDir resolved from the global --cache-dir flag (or env/config defaults).
  const cache = program.command("cache <action>");
  cache.description("Cache maintenance: 'path' prints the cache dir, 'clear' empties it");

  // cache does not call addCommonOptions — it only needs --cache-dir from the
  // global program options, which are already registered on the root program.
  // However, commander inherits the parent's parsed global opts via program.opts(),
  // so the --cache-dir value is available as program.opts().cacheDir inside the action.

  cache.action(async function (action: string, _opts: RawOpts) {
    const globalFlags = mergeGlobal(program.opts(), {});
    const code = await runCache(action as CacheAction, { cacheDir: globalFlags.cacheDir }, io);
    exit(code);
  });

  return program;
}

export async function run(argv: string[] = process.argv.slice(2), deps: CliDeps = {}): Promise<number> {
  let code = 0;
  const exit = (c: number) => {
    code = c;
    if (deps.exit) deps.exit(c);
    else process.exitCode = c;
  };
  const program = createProgram({ ...deps, exit });
  try {
    await program.parseAsync(argv, { from: "user" });
  } catch (e) {
    code = commanderExitCode(e);
    if (deps.exit) deps.exit(code);
    else process.exitCode = code;
  }
  return code;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run().then((c) => {
    if (c !== 0) process.exit(c);
  });
}
```

Run: `npx vitest run test/cli/index.test.ts` — expect PASS (all existing tests plus the six new command-presence and per-command smoke tests).

- [ ] **Step 3: Run the complete CLI test suite.**

Run: `npx vitest run test/cli/` — expect PASS (all six test files: `search.test.ts`, `index.test.ts`, `get.test.ts`, `read.test.ts`, `recent.test.ts`, `download.test.ts`, `cache.test.ts`).

- [ ] **Step 4: Typecheck.**

Run: `npx tsc --noEmit` — expect no errors.

- [ ] **Step 5: Commit.**

```
git add src/cli/index.ts test/cli/index.test.ts
git commit -m "feat(cli): register get/read/recent/download/cache commands in arxiv program"
```

---

## Phase 9: MCP adapter

<!-- Phase: MCP adapter -->

### Task: MCP Server Scaffolding + Search/Recent Tools

**Files:**
- Create: `src/mcp/server.ts`
- Test: `test/mcp/server.test.ts`

**Interfaces:**
- Consumes: `class ArxivClient` (`search(params: SearchParams): Promise<SearchResult>`, `recent(category: string, opts?: { maxResults?: number }): Promise<SearchResult>`) from `src/core/client.ts`; `SearchParams`, `SearchResult` from `src/core/types.ts`; `ArxivError`, `NotFoundError` from `src/core/errors.ts`; `McpServer` from `@modelcontextprotocol/sdk/server/mcp.js`; `z` from `zod`.
- Produces: `export const VERSION: string`; `export type ToolResult`; `export interface ToolRegistry`; `export interface SearchArgs`; `export interface RecentArgs`; `export function searchHandler(client: ArxivClient, args: SearchArgs): Promise<ToolResult>`; `export function recentHandler(client: ArxivClient, args: RecentArgs): Promise<ToolResult>`; `export function registerTools(server: ToolRegistry, client: ArxivClient): void`; `export function buildServer(client: ArxivClient): McpServer` (consumed by the MCP stdio boot and later tool tasks).

- [ ] **Step 1: Write failing tests for `searchHandler`, `recentHandler`, `registerTools`, and `buildServer`.** Create `test/mcp/server.test.ts` and a stub `src/mcp/server.ts` so imports resolve but the assertions fail.

Create `test/mcp/server.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  registerTools,
  searchHandler,
  recentHandler,
  buildServer,
  type ToolRegistry,
  type ToolResult,
} from "../../src/mcp/server.js";
import type { ArxivClient } from "../../src/core/client.js";
import type { SearchResult } from "../../src/core/types.js";
import { NotFoundError } from "../../src/core/errors.js";

const paper = {
  id: "2310.06825",
  version: 1,
  idWithVersion: "2310.06825v1",
  title: "Mistral 7B",
  summary: "A 7B parameter model.",
  authors: [{ name: "Albert Jiang" }, { name: "Guillaume Lample" }],
  categories: ["cs.CL"],
  primaryCategory: "cs.CL",
  published: "2023-10-10T00:00:00Z",
  updated: "2023-10-10T00:00:00Z",
  links: {
    abs: "https://arxiv.org/abs/2310.06825",
    pdf: "https://arxiv.org/pdf/2310.06825",
  },
};

const result: SearchResult = {
  total: 1,
  start: 0,
  count: 1,
  papers: [paper],
  hints: ["Many results — narrow by category/date"],
};

function mockClient(overrides: Partial<ArxivClient> = {}): ArxivClient {
  return { ...overrides } as unknown as ArxivClient;
}

describe("searchHandler", () => {
  it("calls client.search with mapped params and returns text + structuredContent", async () => {
    const client = mockClient({ search: vi.fn().mockResolvedValue(result) });
    const out = await searchHandler(client, { query: "transformer", maxResults: 5 });
    expect(client.search).toHaveBeenCalledWith({ query: "transformer", maxResults: 5 });
    expect(out.isError).toBeUndefined();
    expect(out.structuredContent).toEqual(result);
    expect(out.content[0]).toEqual({ type: "text", text: expect.stringContaining("Found 1 results") });
    expect((out.content[0] as { text: string }).text).toContain("2310.06825 — Mistral 7B");
  });

  it("maps sortBy/sortOrder/start through unchanged", async () => {
    const client = mockClient({ search: vi.fn().mockResolvedValue(result) });
    await searchHandler(client, {
      query: "x",
      category: "cs.CL",
      sortBy: "submittedDate",
      sortOrder: "ascending",
      start: 10,
    });
    expect(client.search).toHaveBeenCalledWith({
      query: "x",
      category: "cs.CL",
      sortBy: "submittedDate",
      sortOrder: "ascending",
      start: 10,
    });
  });

  it("returns an isError envelope on a thrown ArxivError", async () => {
    const client = mockClient({ search: vi.fn().mockRejectedValue(new NotFoundError("no paper")) });
    const out = await searchHandler(client, { query: "x" });
    expect(out.isError).toBe(true);
    expect(out.content[0]).toEqual({ type: "text", text: "Error: no paper" });
    expect(out.structuredContent).toBeUndefined();
  });
});

describe("recentHandler", () => {
  it("calls client.recent(category, {maxResults}) and returns structuredContent", async () => {
    const client = mockClient({ recent: vi.fn().mockResolvedValue(result) });
    const out = await recentHandler(client, { category: "cs.CL", maxResults: 3 });
    expect(client.recent).toHaveBeenCalledWith("cs.CL", { maxResults: 3 });
    expect(out.structuredContent).toEqual(result);
    expect((out.content[0] as { text: string }).text).toContain("Found 1 results");
  });

  it("passes undefined maxResults through when omitted", async () => {
    const client = mockClient({ recent: vi.fn().mockResolvedValue(result) });
    await recentHandler(client, { category: "cs.AI" });
    expect(client.recent).toHaveBeenCalledWith("cs.AI", { maxResults: undefined });
  });

  it("returns isError on failure", async () => {
    const client = mockClient({ recent: vi.fn().mockRejectedValue(new NotFoundError("bad category")) });
    const out = await recentHandler(client, { category: "cs.AI" });
    expect(out.isError).toBe(true);
    expect((out.content[0] as { text: string }).text).toBe("Error: bad category");
  });
});

describe("registerTools (search + recent)", () => {
  it("registers arxiv_search and arxiv_list_recent with input + output schemas", () => {
    const calls: Array<{ name: string; config: { description: string; inputSchema: Record<string, unknown>; outputSchema?: Record<string, unknown> }; handler: (args: unknown) => Promise<ToolResult> }> = [];
    const registry: ToolRegistry = {
      registerTool: (name, config, handler) => {
        calls.push({ name, config: config as typeof calls[number]["config"], handler: handler as typeof calls[number]["handler"] });
      },
    };
    const client = mockClient({ search: vi.fn().mockResolvedValue(result), recent: vi.fn().mockResolvedValue(result) });
    registerTools(registry, client);

    expect(calls.map((c) => c.name)).toEqual(["arxiv_search", "arxiv_list_recent"]);

    const search = calls[0];
    expect(search.config.description).toMatch(/search/i);
    expect(Object.keys(search.config.inputSchema).sort()).toEqual(
      ["abstract", "author", "category", "maxResults", "query", "sortBy", "sortOrder", "start", "title"],
    );
    expect(search.config.outputSchema).toBeDefined();
    expect(Object.keys(search.config.outputSchema!).sort()).toEqual(["count", "hints", "papers", "start", "total"]);

    const recent = calls[1];
    expect(Object.keys(recent.config.inputSchema).sort()).toEqual(["category", "maxResults"]);
    expect(recent.config.outputSchema).toBeDefined();
  });

  it("wires the registered handlers to the handler functions", async () => {
    const calls: Array<{ name: string; handler: (args: unknown) => Promise<ToolResult> }> = [];
    const registry: ToolRegistry = {
      registerTool: (name, _config, handler) => {
        calls.push({ name, handler: handler as (args: unknown) => Promise<ToolResult> });
      },
    };
    const client = mockClient({ search: vi.fn().mockResolvedValue(result), recent: vi.fn().mockResolvedValue(result) });
    registerTools(registry, client);

    const searchOut = await calls[0].handler({ query: "x" });
    expect(searchOut.structuredContent).toEqual(result);
    expect(client.search).toHaveBeenCalledWith({ query: "x" });

    const recentOut = await calls[1].handler({ category: "cs.CL" });
    expect(recentOut.structuredContent).toEqual(result);
    expect(client.recent).toHaveBeenCalledWith("cs.CL", { maxResults: undefined });
  });
});

describe("buildServer", () => {
  it("returns an McpServer instance", () => {
    const server = buildServer(mockClient());
    expect(server).toBeInstanceOf(McpServer);
  });
});
```

Create the stub `src/mcp/server.ts`:

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ArxivClient } from "../core/client.js";
import type { SearchResult } from "../core/types.js";

export const VERSION = "0.1.0";

export type ToolResult = {
  content: Array<{ type: "text"; text: string } | { type: "resource_link"; uri: string; name: string }>;
  structuredContent?: unknown;
  isError?: boolean;
};

export interface ToolRegistry {
  registerTool(
    name: string,
    config: { description: string; inputSchema: Record<string, unknown>; outputSchema?: Record<string, unknown> },
    handler: (args: unknown) => Promise<ToolResult>,
  ): unknown;
}

export interface SearchArgs {
  query?: string;
  author?: string;
  category?: string;
  title?: string;
  abstract?: string;
  sortBy?: "relevance" | "submittedDate" | "lastUpdatedDate";
  sortOrder?: "ascending" | "descending";
  maxResults?: number;
  start?: number;
}

export interface RecentArgs {
  category: string;
  maxResults?: number;
}

export async function searchHandler(_client: ArxivClient, _args: SearchArgs): Promise<ToolResult> {
  return { content: [{ type: "text", text: "" }] };
}

export async function recentHandler(_client: ArxivClient, _args: RecentArgs): Promise<ToolResult> {
  return { content: [{ type: "text", text: "" }] };
}

export function registerTools(_server: ToolRegistry, _client: ArxivClient): void {
  // stub: registers nothing
}

export function buildServer(_client: ArxivClient): McpServer {
  return new McpServer({ name: "arxiv", version: VERSION });
}

void z;
void (null as unknown as SearchResult);
```

Run: `npx vitest run test/mcp/server.test.ts` — expect FAIL (handlers return empty text and no `structuredContent`; `registerTools` registers nothing so the names array is `[]`, not `["arxiv_search","arxiv_list_recent"]`).

- [ ] **Step 2: Implement the shared shapes, `errorResult`, `searchHandler`, `recentHandler`, `registerTools`, and `buildServer`.** Replace `src/mcp/server.ts` with the full implementation. The zod raw shapes (`paperShape`, `searchResultShape`) are reused as `outputSchema` values for both search-family tools. Handlers build `SearchParams` by copying only defined fields so `toHaveBeenCalledWith` matches exactly, and catch every throw into `errorResult` so no raw exception ever escapes a tool.

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ArxivClient } from "../core/client.js";
import type { SearchParams, SearchResult } from "../core/types.js";

export const VERSION = "0.1.0";

export type ToolResult = {
  content: Array<{ type: "text"; text: string } | { type: "resource_link"; uri: string; name: string }>;
  structuredContent?: unknown;
  isError?: boolean;
};

export interface ToolRegistry {
  registerTool(
    name: string,
    config: {
      description: string;
      title?: string;
      inputSchema: Record<string, z.ZodType>;
      outputSchema?: Record<string, z.ZodType>;
    },
    handler: (args: Record<string, unknown>) => Promise<ToolResult>,
  ): unknown;
}

export interface SearchArgs {
  query?: string;
  author?: string;
  category?: string;
  title?: string;
  abstract?: string;
  sortBy?: "relevance" | "submittedDate" | "lastUpdatedDate";
  sortOrder?: "ascending" | "descending";
  maxResults?: number;
  start?: number;
}

export interface RecentArgs {
  category: string;
  maxResults?: number;
}

const authorShape = { name: z.string(), affiliation: z.string().optional() };
const linksShape = { abs: z.string(), pdf: z.string(), html: z.string().optional() };

export const paperShape = {
  id: z.string(),
  version: z.number().optional(),
  idWithVersion: z.string().optional(),
  title: z.string(),
  summary: z.string(),
  authors: z.array(z.object(authorShape)),
  categories: z.array(z.string()),
  primaryCategory: z.string(),
  published: z.string(),
  updated: z.string(),
  doi: z.string().optional(),
  journalRef: z.string().optional(),
  comment: z.string().optional(),
  links: z.object(linksShape),
};

export const searchResultShape = {
  total: z.number(),
  start: z.number(),
  count: z.number(),
  papers: z.array(z.object(paperShape)),
  hints: z.array(z.string()).optional(),
};

function errorResult(err: unknown): ToolResult {
  const msg = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
}

function formatSearchText(r: SearchResult): string {
  const lines = [`Found ${r.total} results (showing ${r.start + 1}-${r.start + r.count})`];
  for (const p of r.papers) lines.push(`- ${p.id} — ${p.title}`);
  if (r.hints && r.hints.length) lines.push("", ...r.hints);
  return lines.join("\n");
}

export async function searchHandler(client: ArxivClient, args: SearchArgs): Promise<ToolResult> {
  try {
    const params: SearchParams = {};
    if (args.query !== undefined) params.query = args.query;
    if (args.author !== undefined) params.author = args.author;
    if (args.category !== undefined) params.category = args.category;
    if (args.title !== undefined) params.title = args.title;
    if (args.abstract !== undefined) params.abstract = args.abstract;
    if (args.sortBy !== undefined) params.sortBy = args.sortBy;
    if (args.sortOrder !== undefined) params.sortOrder = args.sortOrder;
    if (args.maxResults !== undefined) params.maxResults = args.maxResults;
    if (args.start !== undefined) params.start = args.start;
    const result = await client.search(params);
    return { content: [{ type: "text", text: formatSearchText(result) }], structuredContent: result };
  } catch (err) {
    return errorResult(err);
  }
}

export async function recentHandler(client: ArxivClient, args: RecentArgs): Promise<ToolResult> {
  try {
    const result = await client.recent(args.category, { maxResults: args.maxResults });
    return { content: [{ type: "text", text: formatSearchText(result) }], structuredContent: result };
  } catch (err) {
    return errorResult(err);
  }
}

export function registerTools(server: ToolRegistry, client: ArxivClient): void {
  server.registerTool(
    "arxiv_search",
    {
      description: "Search arXiv papers by free-text query and/or field filters (title, author, abstract, category).",
      inputSchema: {
        query: z.string().optional(),
        author: z.string().optional(),
        category: z.string().optional(),
        title: z.string().optional(),
        abstract: z.string().optional(),
        sortBy: z.enum(["relevance", "submittedDate", "lastUpdatedDate"]).optional(),
        sortOrder: z.enum(["ascending", "descending"]).optional(),
        maxResults: z.number().int().optional(),
        start: z.number().int().optional(),
      },
      outputSchema: searchResultShape,
    },
    async (args) => searchHandler(client, args as unknown as SearchArgs),
  );

  server.registerTool(
    "arxiv_list_recent",
    {
      description: "List the most recent arXiv papers in a category (sorted by submission date, newest first).",
      inputSchema: {
        category: z.string(),
        maxResults: z.number().int().optional(),
      },
      outputSchema: searchResultShape,
    },
    async (args) => recentHandler(client, args as unknown as RecentArgs),
  );
}

export function buildServer(client: ArxivClient): McpServer {
  const server = new McpServer({ name: "arxiv", version: VERSION });
  registerTools(server as unknown as ToolRegistry, client);
  return server;
}
```

Run: `npx vitest run test/mcp/server.test.ts` — expect PASS.

- [ ] **Step 3: Commit the MCP scaffolding and search/recent tools.**

```
git add src/mcp/server.ts test/mcp/server.test.ts
git commit -m "feat(mcp): scaffold MCP server with search and list_recent tools"
```

---

### Task: Metadata + Read Tools

**Files:**
- Modify: `src/mcp/server.ts`
- Test: `test/mcp/server.test.ts`

**Interfaces:**
- Consumes: `class ArxivClient` (`getPapers(ids: string[]): Promise<Paper[]>`, `toBibTeX(id: string): Promise<string>`, `getContent(id: string, opts?: ReadOptions): Promise<PaperContent>`) from `src/core/client.ts`; `Paper`, `PaperContent`, `ReadOptions` from `src/core/types.ts`; `registerTools(server, client)` and `paperShape`/`searchResultShape` from `src/mcp/server.ts`.
- Produces: `export interface MetadataArgs`; `export interface ReadArgs`; `export const metadataShape`; `export const contentShape`; `export function metadataHandler(client: ArxivClient, args: MetadataArgs): Promise<ToolResult>`; `export function readHandler(client: ArxivClient, args: ReadArgs): Promise<ToolResult>` (registered inside `registerTools`).

- [ ] **Step 1: Write failing tests for `metadataHandler` and `readHandler`, and extend the `registerTools` names test to expect 4 tools.** Append the new describes to `test/mcp/server.test.ts` and update the existing `registerTools` names assertion; add stub `metadataHandler`/`readHandler` to `src/mcp/server.ts` so imports resolve but assertions fail.

Append to `test/mcp/server.test.ts` (add these imports at the top alongside the existing ones):

```ts
import {
  registerTools,
  searchHandler,
  recentHandler,
  metadataHandler,
  readHandler,
  buildServer,
  type ToolRegistry,
  type ToolResult,
} from "../../src/mcp/server.js";
import type { ArxivClient } from "../../src/core/client.js";
import type { SearchResult, PaperContent } from "../../src/core/types.js";
import { NotFoundError, ParseError } from "../../src/core/errors.js";
```

Update the existing `it("registers arxiv_search and arxiv_list_recent ...")` assertion to expect all four names:

```ts
expect(calls.map((c) => c.name)).toEqual([
  "arxiv_search",
  "arxiv_list_recent",
  "arxiv_get_metadata",
  "arxiv_read_paper",
]);
```

Append the new test groups:

```ts
const content: PaperContent = {
  id: "2310.06825",
  version: 1,
  source: "html-native",
  format: "markdown",
  title: "Mistral 7B",
  abstract: "A 7B parameter model.",
  sections: [
    { id: "S1", title: "Introduction", level: 1, content: "Hello world." },
    { id: "S2", title: "Method", level: 1, content: "We do things." },
  ],
  text: "# Mistral 7B\n\nHello world.",
  truncated: true,
  nextCursor: "eyJpZCI6IjIzMTAuMDY4MjUifQ==",
  warnings: ["ar5iv fallback used"],
};

describe("metadataHandler", () => {
  it("returns per-ID metadata as structuredContent without bibtex by default", async () => {
    const client = mockClient({ getPapers: vi.fn().mockResolvedValue([paper]) });
    const out = await metadataHandler(client, { ids: ["2310.06825"] });
    expect(client.getPapers).toHaveBeenCalledWith(["2310.06825"]);
    expect(out.isError).toBeUndefined();
    expect(out.structuredContent).toEqual({ papers: [paper] });
    expect((out.content[0] as { text: string }).text).toContain("Metadata for 1 paper(s)");
    expect((out.content[0] as { text: string }).text).toContain("2310.06825 — Mistral 7B");
  });

  it("fetches bibtex per id when bibtex:true and includes it in structuredContent", async () => {
    const client = mockClient({
      getPapers: vi.fn().mockResolvedValue([paper]),
      toBibTeX: vi.fn().mockResolvedValue("@misc{Jiang2023mistral, ...}"),
    });
    const out = await metadataHandler(client, { ids: ["2310.06825", "1706.03762"], bibtex: true });
    expect(client.toBibTeX).toHaveBeenCalledTimes(2);
    expect(client.toBibTeX).toHaveBeenNthCalledWith(1, "2310.06825");
    expect(client.toBibTeX).toHaveBeenNthCalledWith(2, "1706.03762");
    expect(out.structuredContent).toEqual({
      papers: [paper],
      bibtex: ["@misc{Jiang2023mistral, ...}", "@misc{Jiang2023mistral, ...}"],
    });
    expect((out.content[0] as { text: string }).text).toContain("BibTeX:");
  });

  it("returns isError on failure", async () => {
    const client = mockClient({ getPapers: vi.fn().mockRejectedValue(new NotFoundError("missing")) });
    const out = await metadataHandler(client, { ids: ["x"] });
    expect(out.isError).toBe(true);
    expect((out.content[0] as { text: string }).text).toBe("Error: missing");
  });
});

describe("readHandler", () => {
  it("calls client.getContent with mapped ReadOptions and returns content + structuredContent", async () => {
    const client = mockClient({ getContent: vi.fn().mockResolvedValue(content) });
    const out = await readHandler(client, {
      id: "2310.06825",
      source: "html",
      format: "markdown",
      section: "Introduction",
      maxChars: 1000,
      cursor: "abc",
    });
    expect(client.getContent).toHaveBeenCalledWith("2310.06825", {
      source: "html",
      format: "markdown",
      section: "Introduction",
      maxChars: 1000,
      cursor: "abc",
    });
    expect(out.structuredContent).toEqual(content);
    expect((out.content[0] as { text: string }).text).toContain("# Mistral 7B");
    expect((out.content[0] as { text: string }).text).toContain("Hello world.");
  });

  it("passes only the id when no options are given", async () => {
    const client = mockClient({ getContent: vi.fn().mockResolvedValue(content) });
    await readHandler(client, { id: "2310.06825" });
    expect(client.getContent).toHaveBeenCalledWith("2310.06825", {});
  });

  it("surfaces a cursor mismatch as an isError envelope", async () => {
    const client = mockClient({ getContent: vi.fn().mockRejectedValue(new ParseError("cursor bound to another id")) });
    const out = await readHandler(client, { id: "2310.06825", cursor: "zzz" });
    expect(out.isError).toBe(true);
    expect((out.content[0] as { text: string }).text).toBe("Error: cursor bound to another id");
  });
});

describe("registerTools (metadata + read)", () => {
  it("registers arxiv_get_metadata and arxiv_read_paper with schemas", () => {
    const calls: Array<{ name: string; config: { inputSchema: Record<string, unknown>; outputSchema?: Record<string, unknown> } }> = [];
    const registry: ToolRegistry = {
      registerTool: (name, config) => {
        calls.push({ name, config: config as typeof calls[number]["config"] });
      },
    };
    registerTools(registry, mockClient());
    const byName = Object.fromEntries(calls.map((c) => [c.name, c]));

    expect(byName["arxiv_get_metadata"].config.inputSchema).toHaveProperty("ids");
    expect(byName["arxiv_get_metadata"].config.inputSchema).toHaveProperty("bibtex");
    expect(byName["arxiv_get_metadata"].config.outputSchema).toBeDefined();
    expect(Object.keys(byName["arxiv_get_metadata"].config.outputSchema!).sort()).toEqual(["bibtex", "papers"]);

    expect(Object.keys(byName["arxiv_read_paper"].config.inputSchema).sort()).toEqual(
      ["cursor", "format", "id", "maxChars", "section", "source"],
    );
    expect(byName["arxiv_read_paper"].config.outputSchema).toBeDefined();
    expect(byName["arxiv_read_paper"].config.outputSchema).toHaveProperty("nextCursor");
  });
});
```

Add stubs to `src/mcp/server.ts` (export the new symbols with wrong behavior and leave `registerTools` unchanged so the new tools are not registered yet):

```ts
export interface MetadataArgs { ids: string[]; bibtex?: boolean }
export interface ReadArgs {
  id: string;
  source?: "auto" | "html" | "pdf";
  format?: "markdown" | "text";
  section?: string;
  maxChars?: number;
  cursor?: string;
}

export async function metadataHandler(_client: ArxivClient, _args: MetadataArgs): Promise<ToolResult> {
  return { content: [{ type: "text", text: "" }] };
}

export async function readHandler(_client: ArxivClient, _args: ReadArgs): Promise<ToolResult> {
  return { content: [{ type: "text", text: "" }] };
}
```

Run: `npx vitest run test/mcp/server.test.ts` — expect FAIL (metadata/read handlers return empty text and no `structuredContent`; `registerTools` still registers only 2 tools so the names array and the `byName["arxiv_get_metadata"]` lookups fail).

- [ ] **Step 2: Implement `metadataShape`, `contentShape`, `metadataHandler`, `readHandler`, and register both tools.** Add the shapes and handlers to `src/mcp/server.ts` and extend `registerTools`.

Add the shapes (after `searchResultShape`):

```ts
export const metadataShape = {
  papers: z.array(z.object(paperShape)),
  bibtex: z.array(z.string()).optional(),
};

const sectionShape = {
  id: z.string().optional(),
  title: z.string(),
  level: z.number(),
  content: z.string(),
};

export const contentShape = {
  id: z.string(),
  version: z.number().optional(),
  source: z.enum(["html-native", "html-ar5iv", "pdf"]),
  format: z.enum(["markdown", "text"]),
  title: z.string(),
  abstract: z.string().optional(),
  sections: z.array(z.object(sectionShape)),
  text: z.string(),
  truncated: z.boolean(),
  nextCursor: z.string().optional(),
  warnings: z.array(z.string()).optional(),
};
```

Add the imports to the top of `src/mcp/server.ts`:

```ts
import type { Paper, PaperContent, ReadOptions, SearchParams, SearchResult } from "../core/types.js";
```

Add the handlers (after `recentHandler`):

```ts
export interface MetadataArgs {
  ids: string[];
  bibtex?: boolean;
}

export interface ReadArgs {
  id: string;
  source?: "auto" | "html" | "pdf";
  format?: "markdown" | "text";
  section?: string;
  maxChars?: number;
  cursor?: string;
}

export async function metadataHandler(client: ArxivClient, args: MetadataArgs): Promise<ToolResult> {
  try {
    const papers: Paper[] = await client.getPapers(args.ids);
    const structured: { papers: Paper[]; bibtex?: string[] } = { papers };
    let text = `Metadata for ${papers.length} paper(s)\n` + papers.map((p) => `- ${p.id} — ${p.title}`).join("\n");
    if (args.bibtex) {
      structured.bibtex = await Promise.all(args.ids.map((id) => client.toBibTeX(id)));
      text += `\n\nBibTeX:\n${structured.bibtex.join("\n\n")}`;
    }
    return { content: [{ type: "text", text }], structuredContent: structured };
  } catch (err) {
    return errorResult(err);
  }
}

export async function readHandler(client: ArxivClient, args: ReadArgs): Promise<ToolResult> {
  try {
    const opts: ReadOptions = {};
    if (args.source !== undefined) opts.source = args.source;
    if (args.format !== undefined) opts.format = args.format;
    if (args.section !== undefined) opts.section = args.section;
    if (args.maxChars !== undefined) opts.maxChars = args.maxChars;
    if (args.cursor !== undefined) opts.cursor = args.cursor;
    const content: PaperContent = await client.getContent(args.id, opts);
    const text = `# ${content.title}\n\n${content.text}`;
    return { content: [{ type: "text", text }], structuredContent: content };
  } catch (err) {
    return errorResult(err);
  }
}
```

Extend `registerTools` (append two more `server.registerTool` calls before the closing brace):

```ts
  server.registerTool(
    "arxiv_get_metadata",
    {
      description: "Fetch metadata for one or more arXiv IDs, optionally including BibTeX for each ID.",
      inputSchema: {
        ids: z.array(z.string()).min(1),
        bibtex: z.boolean().optional(),
      },
      outputSchema: metadataShape,
    },
    async (args) => metadataHandler(client, args as unknown as MetadataArgs),
  );

  server.registerTool(
    "arxiv_read_paper",
    {
      description: "Read the full text of an arXiv paper as section-aware Markdown or plain text, with chunking via maxChars/cursor.",
      inputSchema: {
        id: z.string(),
        source: z.enum(["auto", "html", "pdf"]).optional(),
        format: z.enum(["markdown", "text"]).optional(),
        section: z.string().optional(),
        maxChars: z.number().int().optional(),
        cursor: z.string().optional(),
      },
      outputSchema: contentShape,
    },
    async (args) => readHandler(client, args as unknown as ReadArgs),
  );
```

Run: `npx vitest run test/mcp/server.test.ts` — expect PASS.

- [ ] **Step 3: Commit the metadata and read tools.**

```
git add src/mcp/server.ts test/mcp/server.test.ts
git commit -m "feat(mcp): add arxiv_get_metadata and arxiv_read_paper tools"
```

---

### Task: Download Tool + stdio Boot

**Files:**
- Modify: `src/mcp/server.ts`
- Create: `src/mcp/index.ts`
- Test: `test/mcp/server.test.ts`, `test/mcp/index.test.ts`

**Interfaces:**
- Consumes: `class ArxivClient` (`download(id: string, opts?: DownloadOptions): Promise<{ path: string; bytes: number }>`) from `src/core/client.ts`; `DownloadOptions` from `src/core/types.ts`; `registerTools` from `src/mcp/server.ts`; `StdioServerTransport` from `@modelcontextprotocol/sdk/server/stdio.js`.
- Produces: `export interface DownloadArgs`; `export const downloadShape`; `export function downloadHandler(client: ArxivClient, args: DownloadArgs): Promise<ToolResult>` (registered inside `registerTools`); in `src/mcp/index.ts`: `export interface BootDeps`, `export async function main(deps?: BootDeps): Promise<void>` (the `arxiv-mcp` bin entry).

- [ ] **Step 1: Write failing tests for `downloadHandler`, the 5-tool `registerTools` set, and the stdio `main` boot.** Append the download + full-registry tests to `test/mcp/server.test.ts`, create `test/mcp/index.test.ts`, add a stub `downloadHandler` to `src/mcp/server.ts`, and create a stub `src/mcp/index.ts`.

Append to `test/mcp/server.test.ts` (add `downloadHandler` to the import from `../../src/mcp/server.js`):

```ts
describe("downloadHandler", () => {
  it("downloads to dest dir and returns a text block + a resource_link with a file:// uri", async () => {
    const client = mockClient({
      download: vi.fn().mockResolvedValue({ path: "/tmp/papers/2310.06825.pdf", bytes: 12345 }),
    });
    const out = await downloadHandler(client, { id: "2310.06825", dest: "/tmp/papers" });
    expect(client.download).toHaveBeenCalledWith("2310.06825", { dir: "/tmp/papers" });
    expect(out.isError).toBeUndefined();
    expect(out.structuredContent).toEqual({ path: "/tmp/papers/2310.06825.pdf", bytes: 12345 });
    const text = out.content.find((c) => c.type === "text") as { type: "text"; text: string };
    expect(text.text).toContain("/tmp/papers/2310.06825.pdf");
    expect(text.text).toContain("12345 bytes");
    const link = out.content.find((c) => c.type === "resource_link") as { type: "resource_link"; uri: string; name: string };
    expect(link).toBeDefined();
    expect(link.uri).toBe("file:///tmp/papers/2310.06825.pdf");
    expect(link.name).toBe("2310.06825.pdf");
  });

  it("omits dir when dest is not given", async () => {
    const client = mockClient({
      download: vi.fn().mockResolvedValue({ path: "/data/cond-mat_0011267v1.pdf", bytes: 9 }),
    });
    const out = await downloadHandler(client, { id: "cond-mat/0011267" });
    expect(client.download).toHaveBeenCalledWith("cond-mat/0011267", {});
    const link = out.content.find((c) => c.type === "resource_link") as { type: "resource_link"; uri: string; name: string };
    expect(link.uri).toBe("file:///data/cond-mat_0011267v1.pdf");
    expect(link.name).toBe("cond-mat_0011267v1.pdf");
  });

  it("returns isError on failure", async () => {
    const client = mockClient({ download: vi.fn().mockRejectedValue(new NotFoundError("no pdf")) });
    const out = await downloadHandler(client, { id: "x" });
    expect(out.isError).toBe(true);
    expect((out.content[0] as { text: string }).text).toBe("Error: no pdf");
  });
});

describe("registerTools (full set)", () => {
  it("registers all five arxiv_* tools", () => {
    const names: string[] = [];
    const registry: ToolRegistry = { registerTool: (name) => { names.push(name); } };
    registerTools(registry, mockClient());
    expect(names).toEqual([
      "arxiv_search",
      "arxiv_list_recent",
      "arxiv_get_metadata",
      "arxiv_read_paper",
      "arxiv_download",
    ]);
    expect(names).toHaveLength(5);
  });
});
```

Create `test/mcp/index.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { main } from "../../src/mcp/index.js";
import type { ArxivClient } from "../../src/core/client.js";

function mockClient(): ArxivClient {
  return {} as unknown as ArxivClient;
}

describe("mcp index main", () => {
  it("connects the built server to the transport", async () => {
    const transport = { connect: vi.fn(async (_server: unknown) => {}) };
    await main({ client: mockClient(), transport });
    expect(transport.connect).toHaveBeenCalledTimes(1);
    expect(transport.connect).toHaveBeenCalledWith(expect.objectContaining({ registerTool: expect.any(Function) }));
  });

  it("propagates transport connect errors", async () => {
    const transport = { connect: vi.fn(async () => { throw new Error("stdio broken"); }) };
    await expect(main({ client: mockClient(), transport })).rejects.toThrow("stdio broken");
  });
});
```

Add a stub `downloadHandler` to `src/mcp/server.ts`:

```ts
export interface DownloadArgs { id: string; dest?: string }

export async function downloadHandler(_client: ArxivClient, _args: DownloadArgs): Promise<ToolResult> {
  return { content: [{ type: "text", text: "" }] };
}
```

Create the stub `src/mcp/index.ts`:

```ts
#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildServer } from "./server.js";
import type { ArxivClient } from "../core/client.js";

export interface BootDeps {
  client?: ArxivClient;
  transport?: { connect(server: unknown): Promise<void> };
}

export async function main(_deps: BootDeps = {}): Promise<void> {
  void new StdioServerTransport();
  void buildServer;
}
```

Run: `npx vitest run test/mcp/server.test.ts test/mcp/index.test.ts` — expect FAIL (`downloadHandler` returns empty content with no `resource_link`/`structuredContent`; `registerTools` still registers only 4 tools so the 5-name assertion fails; `main` never calls `transport.connect`).

- [ ] **Step 2: Implement `downloadShape`, `downloadHandler`, register `arxiv_download`, and write the real stdio boot.**

Add `DownloadOptions` to the type import in `src/mcp/server.ts`:

```ts
import type { DownloadOptions, Paper, PaperContent, ReadOptions, SearchParams, SearchResult } from "../core/types.js";
```

Add the shape and handler (after `readHandler`):

```ts
export interface DownloadArgs {
  id: string;
  dest?: string;
}

export const downloadShape = {
  path: z.string(),
  bytes: z.number(),
};

export async function downloadHandler(client: ArxivClient, args: DownloadArgs): Promise<ToolResult> {
  try {
    const opts: DownloadOptions = {};
    if (args.dest !== undefined) opts.dir = args.dest;
    const { path, bytes } = await client.download(args.id, opts);
    const name = path.split("/").pop() ?? path;
    return {
      content: [
        { type: "text", text: `Saved ${path} (${bytes} bytes)` },
        { type: "resource_link", uri: `file://${path}`, name },
      ],
      structuredContent: { path, bytes },
    };
  } catch (err) {
    return errorResult(err);
  }
}
```

Register the tool inside `registerTools` (append after the `arxiv_read_paper` registration):

```ts
  server.registerTool(
    "arxiv_download",
    {
      description: "Download a paper's PDF to a local directory and return the absolute path plus a file:// resource link.",
      inputSchema: {
        id: z.string(),
        dest: z.string().optional(),
      },
      outputSchema: downloadShape,
    },
    async (args) => downloadHandler(client, args as unknown as DownloadArgs),
  );
```

Replace `src/mcp/index.ts` with the real boot (dependency-injected for testability; the shebang block calls `main()` with defaults):

```ts
#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ArxivClient } from "../core/client.js";
import { buildServer } from "./server.js";

export interface BootDeps {
  client?: import("../core/client.js").ArxivClient;
  transport?: { connect(server: unknown): Promise<void> };
}

export async function main(deps: BootDeps = {}): Promise<void> {
  const client = deps.client ?? new ArxivClient();
  const server = buildServer(client);
  const transport = deps.transport ?? new StdioServerTransport();
  await server.connect(transport);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
```

Run: `npx vitest run test/mcp/server.test.ts test/mcp/index.test.ts` — expect PASS.

- [ ] **Step 3: Run the whole MCP suite together.**

Run: `npx vitest run test/mcp/` — expect PASS (both `server.test.ts` and `index.test.ts`).

- [ ] **Step 4: Commit the download tool and stdio boot.**

```
git add src/mcp/server.ts src/mcp/index.ts test/mcp/server.test.ts test/mcp/index.test.ts
git commit -m "feat(mcp): add arxiv_download tool with resource_link and boot stdio server"
```
---

## Phase 10: Browser fallback

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

---

## Phase 11: Packaging & docs

<!-- Phase: Packaging & docs -->

### Task: Finalize packaging (package.json, tsdown bin shebangs, exports, engines, LICENSE)

**Files:**
- `/Users/aildan/arxiv/package.json` (Edit — finalize)
- `/Users/aildan/arxiv/tsdown.config.ts` (Edit/Verify — native bin shebangs, no manual banner)
- `/Users/aildan/arxiv/LICENSE` (Create — MIT)
- `/Users/aildan/arxiv/CONTRIBUTING.md` (Create — build Node ≥ 22.18 note)
- `/Users/aildan/arxiv/test/smoke/build.test.ts` (Create — build smoke assertions)

**Interfaces:**
- Consumes: the three build entries `src/index.ts` (lib), `src/cli/index.ts`, `src/mcp/index.ts` produced by earlier phases; `tsdown.config.ts` from Phase 1.
- Produces: a publishable `package.json` with `bin`, `exports`, `files`, `engines` (runtime), `devEngines` (build); a `tsdown.config.ts` that uses native bin support so the `#!/usr/bin/env node` shebang lands **only** on `dist/cli.js` and `dist/mcp.js`; an MIT `LICENSE`; a build smoke test.

**Notes for the implementer:** This task is config/docs, not TDD source — adapt the template to "write the file, then verify with a concrete command." The critical correctness property is the **bin shebang isolation**: tsdown's native bin support injects the shebang per bin entry; do **not** add a manual `banner`/`esbuild.banner` that would leak `#!/usr/bin/env node` onto `dist/index.js` (the library chunk must remain a clean module with no shebang, so it is importable). Runtime floor is `>=20.19` (published package), but **building requires `>=22.18`** because `tsdown@0.22.3` engines are `^22.18 || >=24.11`; express this via `devEngines` + a CONTRIBUTING note, **not** by raising `engines.node` (which would falsely block runtime consumers on Node 20). License is MIT.

- [ ] **Step 1: Finalize package.json.** Ensure the following fields are present and correct. Complete relevant excerpt (merge into the existing manifest; do not drop existing deps/scripts):

```jsonc
{
  "name": "arxiv-toolkit",
  "version": "0.1.0",
  "type": "module",
  "description": "Search arXiv, fetch metadata, and read papers (HTML→Markdown with PDF fallback) — CLI and MCP server.",
  "license": "MIT",
  "author": {
    "name": "arxiv-toolkit contributors",
    "email": "noreply@example.com",
    "url": "https://github.com/anthropics/arxiv-toolkit"
  },
  "repository": {
    "type": "git",
    "url": "https://github.com/anthropics/arxiv-toolkit"
  },
  "homepage": "https://github.com/anthropics/arxiv-toolkit#readme",
  "bugs": {
    "url": "https://github.com/anthropics/arxiv-toolkit/issues"
  },
  "engines": {
    "node": ">=20.19"
  },
  "devEngines": {
    "node": "^22.18 || >=24.11"
  },
  "files": [
    "dist"
  ],
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "bin": {
    "arxiv": "./dist/cli.js",
    "arxiv-mcp": "./dist/mcp.js"
  },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsdown",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:live": "ARXIV_LIVE=1 vitest run"
  },
  "keywords": [
    "arxiv",
    "arXiv",
    "papers",
    "research",
    "mcp",
    "model-context-protocol",
    "cli",
    "markdown",
    "bibtex"
  ]
}
```

- [ ] **Step 2: Verify tsdown.config.ts uses native bin support (no manual banner).** Open `/Users/aildan/arxiv/tsdown.config.ts` and confirm it declares three entries with bin shebangs via tsdown's native mechanism. Expected shape:

```ts
import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    cli: "src/cli/index.ts",
    mcp: "src/mcp/index.ts",
  },
  format: "esm",
  platform: "node",
  dts: true,
  clean: true,
  // Native bin support: tsdown injects the #!/usr/bin/env node shebang
  // ONLY onto the chunks listed in `bin` (cli, mcp). The library chunk
  // (index) stays a clean importable module with NO shebang.
  // DO NOT add a manual banner() that would leak the shebang onto index.
  bin: {
    cli: "arxiv",
    mcp: "arxiv-mcp",
  },
  // If tsdown's `bin` option is unavailable in 0.22.3, fall back to adding
  // the shebang via a targeted output hook ONLY on cli.js and mcp.js (never
  // index.js) — but first attempt native `bin` (preferred).
});
```

If tsdown's `bin` key is unavailable in the installed version, replace the `bin` block with a post-build hook that prepends `#!/usr/bin/env node\n` exclusively to `dist/cli.js` and `dist/mcp.js` (verify by exact path, not by globbing all chunks). Do not proceed with any config that adds the shebang to `dist/index.js`.

- [ ] **Step 3: Create the MIT LICENSE file.** Complete contents (year 2026, copyright holder "arxiv-toolkit contributors"):

```text
MIT License

Copyright (c) 2026 arxiv-toolkit contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 4: Create CONTRIBUTING.md with the build/runtime Node split.** Complete contents:

```markdown
# Contributing to arxiv-toolkit

## Prerequisites

- **Building and developing** this package requires **Node ≥ 22.18** (or ≥ 24.11).
  The build tool, `tsdown@0.22.3`, declares `engines` of `^22.18 || >=24.11`.
  This is a **build-only** requirement and is recorded in `package.json#devEngines`.
- The **published package** runs on **Node ≥ 20.19** (recorded in
  `package.json#engines.node`). Do not raise `engines.node` to satisfy the build —
  that would block runtime consumers on Node 20. CI must use ≥ 22.18.

## Setup

```bash
node --version   # confirm >= 22.18
npm install
npm run build     # tsdown -> dist/{index,cli,mcp}.js (+ .d.ts, bin shebangs)
npm test          # vitest unit + adapter tests (no network)
npm run typecheck  # tsc --noEmit
```

## Live integration tests

Tests that hit the real arXiv endpoints are gated behind `ARXIV_LIVE=1` and are
**excluded from CI**:

```bash
ARXIV_LIVE=1 npm test
```

## Conventions

- **ESM + NodeNext.** `"type": "module"`. All relative imports carry the `.js` suffix.
- **TDD.** Write the failing test first, watch it fail, implement minimally, watch it pass.
- **One focused commit per task**, conventional-commit messages.
- **arXiv etiquette is mandatory:** descriptive User-Agent with contact, per-host min-interval limiter (default 3000 ms), retry/backoff on 429/5xx, `max_results` clamped to ≤ 2000.
```

- [ ] **Step 5: Write the build smoke test.** Create `/Users/aildan/arxiv/test/smoke/build.test.ts` — asserts the three dist files exist and that shebangs are present only on the two bins (never on the library chunk). Complete file:

```ts
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const distDir = resolve(__dirname, "..", "..", "dist");

describe("build output", () => {
  it("emits dist/index.js, dist/cli.js, dist/mcp.js", () => {
    expect(existsSync(resolve(distDir, "index.js"))).toBe(true);
    expect(existsSync(resolve(distDir, "cli.js"))).toBe(true);
    expect(existsSync(resolve(distDir, "mcp.js"))).toBe(true);
  });

  it("emits dist/index.d.ts for the library", () => {
    expect(existsSync(resolve(distDir, "index.d.ts"))).toBe(true);
  });

  const SHEBANG = "#!/usr/bin/env node";

  it("cli.js has the node shebang", () => {
    const head = readFileSync(resolve(distDir, "cli.js"), "utf8").slice(0, SHEBANG.length);
    expect(head).toBe(SHEBANG);
  });

  it("mcp.js has the node shebang", () => {
    const head = readFileSync(resolve(distDir, "mcp.js"), "utf8").slice(0, SHEBANG.length);
    expect(head).toBe(SHEBANG);
  });

  it("index.js does NOT have a shebang (library chunk stays clean/importable)", () => {
    const head = readFileSync(resolve(distDir, "index.js"), "utf8").slice(0, SHEBANG.length);
    expect(head).not.toBe(SHEBANG);
  });
});
```

- [ ] **Step 6: Build, run the smoke test, typecheck.** Run:

```bash
npm run build
npx vitest run test/smoke/build.test.ts
npm run typecheck
```

Expected: build succeeds emitting `dist/{index,cli,mcp}.js` + `dist/index.d.ts`; smoke test passes (shebangs present only on `cli.js`/`mcp.js`, absent on `index.js`); typecheck clean. If the shebang leaked onto `index.js`, fix `tsdown.config.ts` per Step 2's guidance (remove any manual banner; use native `bin` or a targeted post-build hook) and re-run.

- [ ] **Step 7: Commit.** Run:

```
git add package.json tsdown.config.ts LICENSE CONTRIBUTING.md test/smoke/build.test.ts && git commit -m "build(packaging): finalize bins, exports, engines, MIT license, build smoke

- package.json: exports map (types+import), bin {arxiv,arxiv-mcp},
  files:[\"dist\"], engines.node >=20.19 (runtime), devEngines ^22.18||>=24.11 (build).
- tsdown native bin support: #!/usr/bin/env node lands only on cli.js/mcp.js;
  index.js stays a clean importable module (no manual banner).
- LICENSE (MIT), CONTRIBUTING (build/runtime Node split, conventions).
- Build smoke test asserts dist files exist and shebang isolation.
"
```

### Task: Author README.md (install, usage, MCP registration, browser fallback, bulk pointers)

**Files:**
- `/Users/aildan/arxiv/README.md` (Create)

**Interfaces:**
- Consumes: the CLI surface (Phase 5/8), MCP surface (Phase 9), browser fallback (Phase 10), and the §5.4 bulk-access pointers from the spec.
- Produces: a single README covering install (global + npx gotcha), all CLI commands, MCP registration (Claude Code + config-file forms), the browser-fallback note, and bulk-access pointers.

**Notes for the implementer:** The bin names (`arxiv`, `arxiv-mcp`) differ from the package name (`arxiv-toolkit`), so `npx arxiv-toolkit ...` does **not** resolve to the bins. The documented forms use `--package`: `npx -y --package arxiv-toolkit arxiv ...` and `npx -y --package arxiv-toolkit arxiv-mcp`. The MCP registration uses `claude mcp add` with options **before** the name and `--` **before** the command. The browser fallback is **off by default**; document the opt-in (`--browser`, `ARXIV_BROWSER=1`) and the graceful-degradation behavior. Bulk access (OAI-PMH / S3 / Kaggle) is **pointers only** — out of scope for the toolkit.

- [ ] **Step 1: Write README.md.** Create the file. Complete contents:

```markdown
# arxiv-toolkit

A TypeScript library exposed as a **CLI** (`arxiv`) and an **MCP server** (`arxiv-mcp`) for
searching arXiv, fetching metadata, and reading papers as clean, section-aware Markdown
(HTML → ar5iv → PDF fallback). API-first over arXiv's official endpoints, with a lazy
browser fallback (off by default).

- **Search & discovery** — full-text and field-scoped search (title, author, abstract, category), boolean queries, sorting, pagination, and a "recent in a category" listing.
- **Read full text** — section-aware Markdown (or plain text), chunkable via `maxChars`/`cursor` so an LLM can read large papers within a context budget.
- **Metadata & export** — rich metadata for one or many IDs and BibTeX export (canonical arXiv endpoint, with an offline `@misc` generator fallback).
- **Polite & portable** — per-host rate limiting, retry/backoff, aggressive caching, OS-native paths. No browser required.

## Install

### Global

```bash
npm install -g arxiv-toolkit
```

After global install, both bins are on `PATH`:

```bash
arxiv search "transformer attention"
arxiv-mcp   # starts the stdio MCP server
```

### npx (no global install)

> **Gotcha:** the bin names (`arxiv`, `arxiv-mcp`) differ from the package name
> (`arxiv-toolkit`). `npx arxiv-toolkit ...` does **not** resolve to the bins — use
> `--package`:

```bash
npx -y --package arxiv-toolkit arxiv search "transformer attention"
npx -y --package arxiv-toolkit arxiv read 2310.06825
npx -y --package arxiv-toolkit arxiv-mcp
```

## CLI usage

```
arxiv <command> [options]

Commands:
  search <query>          Search arXiv.
  get <id...>             Fetch metadata for one or more IDs.
  read <id>               Read a paper as Markdown/text.
  download <id...>        Save PDF(s) to disk.
  recent <category>       Latest papers in a category.
  cache <clear|path>      Cache maintenance.

Global options:
  --json              JSON output (scripting)
  --no-cache          Bypass cache
  --cache-dir <dir>   Override cache directory
  --browser           Enable browser fallback (off by default)
  --quiet             Suppress hints/non-fatal warnings
  --verbose           Print stack traces on error
```

### search

```bash
arxiv search "diffusion models" --author "ho" --category cs.LG --sort submitted --max 20 --json
```

Flags: `--author --category --title --abstract --sort relevance|submitted|updated --order asc|desc --max <n> --start <n> --json`. For large result sets (>1000), a narrowing hint is printed to stderr (suppressed by `--quiet`).

### get (metadata + BibTeX)

```bash
arxiv get 2310.06825 cond-mat/0011267
arxiv get 2310.06825 --bibtex --json
```

`get` accepts multiple IDs; the metadata is batched (≤50 IDs per request) and returned in input order. `--bibtex` emits canonical BibTeX from arXiv's `https://arxiv.org/bibtex/{id}` endpoint, falling back to a generated `@misc` entry offline.

### read (full text)

```bash
arxiv read 2310.06825
arxiv read 2310.06825 --format text --section "Method"
arxiv read 2310.06825 --source pdf --max-chars 12000 --out paper.md
```

Flags: `--source auto|html|pdf` (default `auto`: native HTML → ar5iv → PDF), `--format markdown|text` (default `markdown`), `--section <name>` (return one section by `S1`-style id or title substring), `--max-chars <n>` (soft chunk target; snaps to whole-section boundaries), `--out <file>`. Use `--max-chars` to read a paper section-by-section; the `nextCursor` field in `--json` output is the authoritative "more remains" signal.

### download

```bash
arxiv download 2310.06825 cond-mat/0011267 --out ./papers
```

`download <id...>` saves each PDF (old-style IDs are sanitized on disk: `cond-mat/0011267` → `cond-mat_0011267.pdf`). The absolute saved path is printed per ID; processing continues on error and the process exits non-zero if any ID failed.

### recent

```bash
arxiv recent cs.CL --max 10 --json
```

### cache

```bash
arxiv cache clear   # empty the cache
arxiv cache path    # print the cache directory
```

## MCP server

`arxiv-mcp` is a [Model Context Protocol](https://modelcontextprotocol.io) stdio server exposing the same core as five tools: `arxiv_search`, `arxiv_get_metadata`, `arxiv_read_paper`, `arxiv_list_recent`, `arxiv_download`.

### Claude Code

Register the server for your user scope:

```bash
claude mcp add arxiv --scope user -- npx -y --package arxiv-toolkit arxiv-mcp
```

Options go **before** the name and `--` goes **before** the command. The registered server name `arxiv` and the bin `arxiv-mcp` are intentionally distinct (logical name vs. launcher). Verify with `claude mcp list`.

### Config-file forms

Equivalent static config for `.mcp.json` (Claude Code) or `claude_desktop_config.json` (Claude Desktop):

```jsonc
{
  "mcpServers": {
    "arxiv": {
      "command": "npx",
      "args": ["-y", "--package", "arxiv-toolkit", "arxiv-mcp"]
    }
  }
}
```

With a global install, use the bin directly:

```jsonc
{
  "mcpServers": {
    "arxiv": {
      "command": "arxiv-mcp"
    }
  }
}
```

### Tools

| Tool | Purpose |
|---|---|
| `arxiv_search` | Search arXiv; returns `{total,start,count,papers[],hints[]}` + text summary. |
| `arxiv_get_metadata` | Metadata for one or more IDs; optional BibTeX. |
| `arxiv_read_paper` | Section-aware Markdown/text with `nextCursor` for chunked reads. |
| `arxiv_list_recent` | Recent papers in a category. |
| `arxiv_download` | Save a PDF; returns the absolute path + a `file://` resource link. |

## Browser fallback (off by default)

The API-first path (official arXiv endpoints) is the default and needs no browser. An
optional browser fallback (`playwright-core`, an `optionalDependency`, lazy-loaded) can
retry the **same** URLs when the API path fails for a **non-content** reason (e.g. a
challenge/`403`, or repeated `5xx`/connection/TLS failure after retries are exhausted).
It is **not** triggered by a clean `404` (a legitimate "not available here" → the source
matrix continues to the next source).

Enable it with:

- the `--browser` CLI flag,
- the `ARXIV_BROWSER=1` environment variable, or
- `"browserFallback": true` in the config file.

If no browser binary is installed when the fallback is engaged, `arxiv-toolkit` raises a
clear `UnsupportedError` with install guidance and **leaves the API path unaffected** — it
never breaks the default flow. Cache maintenance is CLI/ops-only; there is no MCP cache
tool.

## Configuration

Configuration is resolved with precedence: CLI flag → environment variable → config file → default. The config file is `<configDir>/config.json` (a `Partial<ArxivConfig>` JSON object; unknown keys are ignored).

| Env var | Field | Notes |
|---|---|---|
| `ARXIV_CACHE_DIR` | `cacheDir` | Cache directory. |
| `ARXIV_DOWNLOADS_DIR` | `downloadsDir` | Default `<data>/papers`. |
| `ARXIV_RATE_MS` | `rateMs` | Per-host min-interval (default 3000). |
| `ARXIV_MAX_RESULTS` | `defaultMaxResults` | Default page size (default 25; the 2000 clamp is fixed). |
| `ARXIV_NO_CACHE` | `noCache` | `1`/`true`/`yes` to bypass. |
| `ARXIV_BROWSER` | `browserFallback` | `1`/`true`/`yes` to enable. |
| `ARXIV_CONTACT` | `contact` | Email used in the User-Agent. |
| `ARXIV_USER_AGENT` | `userAgent` | Overrides the entire UA string. |

Paths are cross-platform via `env-paths`. A descriptive `User-Agent` with a contact email
is sent on every request; please set `ARXIV_CONTACT` to your email so arXiv can reach you
if your usage causes problems.

## Bulk access (out of scope)

This toolkit is for targeted search and reading, not bulk harvesting. For large-scale
access use arXiv's official bulk channels:

- **OAI-PMH** — `https://oaipmh.arxiv.org/oai`
- **AWS S3 (requester-pays)** — `s3://arxiv` (`pdf/`, `src/` + manifests). See [arXiv S3 bulk data](https://info.arxiv.org/help/bulk_data_s3.html).
- **Kaggle** — [Cornell University/arxiv](https://www.kaggle.com/datasets/Cornell-University/arxiv) dump.

See [arXiv bulk data](https://info.arxiv.org/help/bulk_data.html) for guidance and etiquette.

## License

MIT. See [LICENSE](./LICENSE).
```

- [ ] **Step 2: Verify the README renders and links resolve.** Run:

```bash
npx --yes markdown-link-check README.md 2>/dev/null || node -e "console.log('README written')"
```

Expected: README present with all command examples, the `--package` npx gotcha, `claude mcp add` registration, config-file forms, browser-fallback note, and the three bulk-access pointers.

- [ ] **Step 3: Commit.** Run:

```
git add README.md && git commit -m "docs: add README (install, usage, MCP registration, fallback, bulk pointers)

- Install: npm i -g arxiv-toolkit and the npx --package gotcha (bin names != package name).
- CLI usage for search/get/read/download/recent/cache with flags and examples.
- MCP registration: claude mcp add arxiv -- npx -y --package arxiv-toolkit arxiv-mcp,
  plus .mcp.json / claude_desktop_config.json mcpServers entries.
- Browser fallback note (off by default; --browser/ARXIV_BROWSER/config; graceful degrade).
- Bulk-access pointers only: OAI-PMH, AWS S3 s3://arxiv, Kaggle.
"
```

### Task: Live integration tests gated behind ARXIV_LIVE=1

**Files:**
- `/Users/aildan/arxiv/test/live/live.test.ts` (Create)

**Interfaces:**
- Consumes: `ArxivClient` from `src/core/client.ts` (public surface), `normalizeId` from `src/core/ids.ts`.
- Produces: an opt-in integration suite that exercises the real API/HTML/PDF/bibtex paths for a known stable id, skipped unless `ARXIV_LIVE=1`.

**Notes for the implementer:** Live tests must be **excluded from CI** and skipped by default — use `describe.skipIf(!process.env.ARXIV_LIVE)`. Pick a known-stable id with a native HTML rendering; `2310.06825` is the design's example id (verify it still resolves at test time; if it 404s, substitute another post-Dec-2023 id). Do not assert on exact paper text (titles/abstracts can drift across versions) — assert on structural shape and the source matrix. Keep the suite small and polite (a handful of requests, respecting the rate limiter).

- [ ] **Step 1: Write the live test file.** Create `/Users/aildan/arxiv/test/live/live.test.ts`. Complete file:

```ts
import { describe, it, expect } from "vitest";
import { ArxivClient } from "../../src/core/client.js";
import { normalizeId } from "../../src/core/ids.js";

// Live integration tests hit the real arXiv endpoints. They are OPT-IN:
// run with `ARXIV_LIVE=1 npm test`. Skipped in CI and by default.
describe.skipIf(!process.env.ARXIV_LIVE)("live: arXiv endpoints", () => {
  // Known stable id with a native HTML rendering (post-Dec-2023, LaTeX-sourced).
  // If this id ever 404s at the API, substitute another post-Dec-2023 id.
  const STABLE_ID = "2310.06825";

  it("search returns results for a broad query", async () => {
    const client = new ArxivClient();
    const res = await client.search({
      query: "attention is all you need",
      maxResults: 5,
    });
    expect(res.papers.length).toBeGreaterThan(0);
    expect(res.total).toBeGreaterThanOrEqual(res.papers.length);
    for (const p of res.papers) {
      expect(p.id).toBeTruthy();
      expect(p.title).toBeTruthy();
      expect(p.authors.length).toBeGreaterThan(0);
      expect(p.links.abs).toMatch(/^https:\/\/arxiv\.org\/abs\//);
    }
  });

  it("getPaper returns metadata for a known id", async () => {
    const client = new ArxivClient();
    const paper = await client.getPaper(STABLE_ID);
    expect(paper.id).toBe(normalizeId(STABLE_ID).id);
    expect(paper.title).toBeTruthy();
    expect(paper.authors.length).toBeGreaterThan(0);
    expect(paper.links.pdf).toMatch(/^https:\/\/arxiv\.org\/pdf\//);
  });

  it("recent returns recent papers in a category", async () => {
    const client = new ArxivClient();
    const res = await client.recent("cs.CL", { maxResults: 5 });
    expect(res.papers.length).toBeGreaterThan(0);
    for (const p of res.papers) {
      expect(p.categories).toContain("cs.CL");
    }
  });

  it("getContent (auto) resolves a native-HTML or fallback source", async () => {
    const client = new ArxivClient();
    const content = await client.getContent(STABLE_ID, { maxChars: 4000 });
    expect(["html-native", "html-ar5iv", "pdf"]).toContain(content.source);
    expect(content.sections.length).toBeGreaterThan(0);
    expect(content.text.length).toBeGreaterThan(0);
    expect(content.id).toBe(normalizeId(STABLE_ID).id);
  });

  it("getContent chunking walks nextCursor to completion", async () => {
    const client = new ArxivClient();
    const first = await client.getContent(STABLE_ID, { maxChars: 2000 });
    expect(first.sections.length).toBeGreaterThan(0);
    if (first.nextCursor) {
      const second = await client.getContent(STABLE_ID, {
        maxChars: 2000,
        cursor: first.nextCursor,
      });
      expect(second.sections.length).toBeGreaterThanOrEqual(0);
      // The cursor is bound to the same id; a mismatch would throw ParseError.
      expect(second.id).toBe(first.id);
    }
  });

  it("toBibTeX returns canonical BibTeX", async () => {
    const client = new ArxivClient();
    const bib = await client.toBibTeX(STABLE_ID);
    expect(bib).toMatch(/^@misc\{/);
    expect(bib).toContain("archivePrefix={arXiv}");
    expect(bib).toContain(`eprint={${normalizeId(STABLE_ID).id}}`);
  });

  it("download writes a PDF and reports the absolute path", async () => {
    const client = new ArxivClient({ downloadsDir: process.env.RUNNER_TMP });
    const result = await client.download(STABLE_ID);
    expect(result.path).toMatch(/\.pdf$/);
    expect(result.bytes).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Confirm the suite is skipped by default.** Run:

```bash
npm test
```

Expected: the live suite reports **skipped** (0 live network calls); the rest of the unit/adapter suite passes. No live tests run without `ARXIV_LIVE=1`.

- [ ] **Step 3: Run the live suite opt-in.** Run:

```bash
ARXIV_LIVE=1 npm test
```

Expected: the live suite executes against real arXiv endpoints; search, `getPaper`, `recent`, `getContent` (source matrix), cursor continuation, `toBibTeX`, and `download` all pass end-to-end. If the stable id's native HTML has shifted (e.g. temporarily 404s), the `auto` source matrix must still resolve via ar5iv or PDF and the test stays green. If arXiv returns a transient `5xx`/`429`, the retry/backoff path should absorb it; a persistent failure here is a real signal, not a flake to silence.

- [ ] **Step 4: Typecheck.** Run: `npm run typecheck`. Expected: PASS (no errors originating in `test/live/live.test.ts`).

- [ ] **Step 5: Commit.** Run:

```
git add test/live/live.test.ts && git commit -m "test(live): add ARXIV_LIVE-gated integration suite

- describe.skipIf(!process.env.ARXIV_LIVE) — skipped in CI and by default.
- End-to-end: search, getPaper, recent, getContent source matrix, cursor
  continuation, toBibTeX canonical, download absolute path.
- Asserts structural shape over exact text (titles/abstracts drift across versions).
- Known stable id 2310.06825; auto matrix degrades to ar5iv/PDF if native HTML 404s.
"
```
---

## Appendix: Shared Contracts (frozen reference)

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
