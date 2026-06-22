import { describe, it, expect, vi } from "vitest";
import {
  formatRecentJson,
  formatRecentHuman,
  runRecent,
} from "../../../src/cli/commands/recent.js";
import type { ArxivClient } from "../../../src/core/client.js";
import type { SearchResult } from "../../../src/core/types.js";
import { RateLimitedError } from "../../../src/core/errors.js";

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
