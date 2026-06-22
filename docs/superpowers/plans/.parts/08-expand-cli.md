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
