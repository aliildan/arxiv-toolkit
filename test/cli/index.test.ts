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
