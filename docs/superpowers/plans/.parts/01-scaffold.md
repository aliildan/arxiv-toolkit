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
