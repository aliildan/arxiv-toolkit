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
