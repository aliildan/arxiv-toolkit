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
});
