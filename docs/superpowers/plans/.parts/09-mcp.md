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