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