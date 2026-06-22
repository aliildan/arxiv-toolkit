# arxiv-toolkit

A TypeScript library shipped as a **CLI** (`arxiv`) and an **MCP server** (`arxiv-mcp`) for
searching arXiv, fetching metadata, and reading papers (HTML→Markdown with PDF fallback).
API-first over arXiv's official endpoints, with a lazy browser fallback.

**Status:** greenfield. The design and the task-by-task build plan live in `docs/superpowers/`:
- Spec: `docs/superpowers/specs/2026-06-19-arxiv-toolkit-design.md`
- Plan: `docs/superpowers/plans/2026-06-19-arxiv-toolkit.md`

Read the spec before making non-trivial changes — every library version and endpoint behavior
in it was verified against live sources on 2026-06-19.

## Architecture

One ESM package, layered:

- `src/core/` — framework-free library. Knows nothing about the CLI or MCP SDK.
  `ArxivClient` (`core/client.ts`) orchestrates: `ids → cache → rate-limit → DataSource → parse`.
- `src/cli/` — Commander adapter. Thin: parse flags → call `ArxivClient` → format output.
- `src/mcp/` — MCP stdio adapter. Thin: zod schemas → call `ArxivClient` → tool result.

**The `DataSource` interface (`core/datasource/`) is the one seam** where data origin is chosen:
`ApiDataSource` (official endpoints, default) and `BrowserDataSource` (lazy `playwright-core`,
off by default — engaged only when the API path fails for a non-content reason). It is a thin
transport (`query`/`getHtml`/`getPdf`/`getText`); the client builds URLs and decides fallback
order; parsing lives in `core/parse/*`.

**Rule:** adapters depend only on `ArxivClient`'s public surface; never reach into `core` internals.

## Commands

```bash
npm install
npm run build       # tsdown → dist/{index,cli,mcp}.js (+ .d.ts, bin shebangs)
npm test            # vitest (unit + adapter tests; no network)
npm run typecheck   # tsc --noEmit
ARXIV_LIVE=1 npm test   # also runs the gated live integration tests (hits arXiv)
```

## Conventions

- **ESM + NodeNext.** `"type":"module"`; `tsconfig` is NodeNext/ES2022/strict. **All relative
  imports carry the `.js` suffix** (`import { normalizeId } from "./ids.js"`).
- **TDD.** Write the failing test first, watch it fail, implement minimally, watch it pass, commit.
- **Tests** live in `test/` mirroring `src/` paths, named `*.test.ts`. Never hit the network in
  unit tests — mock `fetch` or inject a fake `DataSource`. Live tests are gated behind `ARXIV_LIVE=1`.
- **Commits:** conventional-commit messages; one focused commit per task.
- **Files stay focused** — one responsibility each (see the spec's File Structure table).

## Gotchas (verified — do not "fix" these back)

- **MCP SDK is v1.x only** (`@modelcontextprotocol/sdk@^1.29.0`). The GitHub `main`/v2 is pre-alpha
  with different package names and import paths — do not follow v2 tutorials. Use `McpServer` +
  `registerTool` (not the deprecated `tool()`), import paths keep `.js`
  (`@modelcontextprotocol/sdk/server/mcp.js`), and `import { z } from "zod"`.
- **Build tool is `tsdown`, not `tsup`** (tsup is unmaintained). `tsdown@0.22.3` requires
  **Node ≥ 22.18 to build** — even though the published package's runtime floor is Node ≥ 20.19.
- **Two HTML schemas, two parsers.** Native `arxiv.org/html` uses LaTeXML `ltx_*` classes; `ar5iv`
  uses an older bare-`h1`/`h2` schema. `html-native.ts` and `html-ar5iv.ts` are separate branches
  feeding the shared `html-common.ts` converter. Native HTML 404s for pre-Dec-2023 / PDF-only papers.
- **`fast-xml-parser` needs an `isArray` predicate** for `['entry','author','category','link']`
  (a blanket `() => true` over-applies and breaks the structure).
- **`turndown-plugin-gfm` is CJS:** `import gfmPkg from "turndown-plugin-gfm"; const { gfm } = gfmPkg;`.
- **PDF text via `unpdf`** (bundles PDF.js, worker-free) — not raw `pdfjs-dist`.
- **arXiv etiquette is mandatory:** descriptive User-Agent with contact, a per-host min-interval
  limiter (default 3000 ms), retry/backoff on 429/5xx, and `max_results` clamped to ≤ 2000.
- **API host is `export.arxiv.org` over HTTPS.** Deep paging (large `start`) is unreliable —
  narrow the query instead.
- **Old-style ids keep the literal slash in URLs** (`cond-mat/0011267`, never `%2F`); on disk the
  slash becomes `_` (`cond-mat_0011267.pdf`).
- **`env-paths` returns path strings only** — create directories yourself with `fs.mkdir(recursive)`.
- **There is an official BibTeX endpoint** `https://arxiv.org/bibtex/{id}` — fetch it; the local
  `@misc` generator is the offline fallback.
