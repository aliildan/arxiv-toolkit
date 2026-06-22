import { describe, it, expect, vi } from "vitest";
import {
  formatGetJson,
  formatGetHuman,
  runGet,
} from "../../../src/cli/commands/get.js";
import type { ArxivClient } from "../../../src/core/client.js";
import type { Paper } from "../../../src/core/types.js";
import { NotFoundError, NetworkError } from "../../../src/core/errors.js";

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

  it("bibtex map uses normalized id so versioned/URL inputs still match the returned paper", async () => {
    const bibtexStr = "@misc{vaswani2017attention}";
    const client = {
      getPapers: vi.fn().mockResolvedValue([paper1]), // paper1.id === "1706.03762"
      toBibTeX: vi.fn().mockResolvedValue(bibtexStr),
    } as unknown as ArxivClient;
    const { out, io } = sink();
    // Pass a versioned id; paper returned has normalized id "1706.03762"
    const code = await runGet(client, ["1706.03762v1"], { bibtex: true }, io);
    expect(code).toBe(0);
    expect(out.join("")).toContain(bibtexStr);
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
