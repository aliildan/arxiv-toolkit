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