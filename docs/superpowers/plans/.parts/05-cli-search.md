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