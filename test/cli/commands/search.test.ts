import { describe, it, expect, vi } from "vitest";
import {
  buildSearchParams,
  formatSearchJson,
  formatSearchHuman,
  runSearch,
} from "../../../src/cli/commands/search.js";
import type { ArxivClient } from "../../../src/core/client.js";
import type { SearchResult } from "../../../src/core/types.js";
import { NotFoundError } from "../../../src/core/errors.js";

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
