import { describe, it, expect, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  registerTools,
  searchHandler,
  recentHandler,
  metadataHandler,
  readHandler,
  downloadHandler,
  buildServer,
  type ToolRegistry,
  type ToolResult,
} from "../../src/mcp/server.js";
import type { ArxivClient } from "../../src/core/client.js";
import type { SearchResult, PaperContent } from "../../src/core/types.js";
import { NotFoundError, ParseError } from "../../src/core/errors.js";

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

describe("registerTools (all five tools)", () => {
  it("registers arxiv_search and arxiv_list_recent with input + output schemas", () => {
    const calls: Array<{ name: string; config: { description: string; inputSchema: Record<string, unknown>; outputSchema?: Record<string, unknown> }; handler: (args: unknown) => Promise<ToolResult> }> = [];
    const registry: ToolRegistry = {
      registerTool: (name, config, handler) => {
        calls.push({ name, config: config as typeof calls[number]["config"], handler: handler as typeof calls[number]["handler"] });
      },
    };
    const client = mockClient({ search: vi.fn().mockResolvedValue(result), recent: vi.fn().mockResolvedValue(result) });
    registerTools(registry, client);

    expect(calls.map((c) => c.name)).toEqual([
      "arxiv_search",
      "arxiv_list_recent",
      "arxiv_get_metadata",
      "arxiv_read_paper",
      "arxiv_download",
    ]);

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
