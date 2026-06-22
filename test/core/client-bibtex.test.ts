import { describe, it, expect, vi } from "vitest";
import { ArxivClient } from "../../src/core/client.js";
import type { DataSource } from "../../src/core/datasource/datasource.js";
import type { Paper } from "../../src/core/types.js";
import { generateBibTeX } from "../../src/core/bibtex.js";

// A Paper fixture used both as getPaper's return value and as a source of truth
// for the generated fallback string.
const FIXTURE_PAPER: Paper = {
  id: "2310.06825",
  title: "Attention Is All You Need",
  summary: "We propose a new network architecture, the Transformer.",
  authors: [{ name: "Ashish Vaswani" }, { name: "Noam Shazeer" }],
  categories: ["cs.CL", "cs.AI"],
  primaryCategory: "cs.CL",
  published: "2017-06-12T00:00:00Z",
  updated: "2017-06-12T00:00:00Z",
  links: {
    abs: "https://arxiv.org/abs/2310.06825",
    pdf: "https://arxiv.org/pdf/2310.06825",
  },
};

const CANONICAL_BIBTEX = `@misc{vaswani2017attention_canonical,
  author = {Ashish Vaswani and Noam Shazeer},
  title  = {Attention Is All You Need},
  year   = {2017},
  url    = {https://arxiv.org/abs/2310.06825}
}`;

/**
 * Build a minimal DataSource whose getText resolves or rejects as needed.
 * All other methods throw — they should never be called by toBibTeX.
 */
function makeDataSource(
  getTextImpl: (url: string) => Promise<string>
): DataSource {
  return {
    query: () => Promise.reject(new Error("query: not expected")),
    getHtml: () => Promise.reject(new Error("getHtml: not expected")),
    getPdf: () => Promise.reject(new Error("getPdf: not expected")),
    getText: getTextImpl,
  };
}

/**
 * Construct an ArxivClient whose `this.api` is replaced by our fake DataSource.
 * We also stub `getPaper` on the instance so it returns FIXTURE_PAPER without
 * hitting the network.
 */
function makeClient(ds: DataSource): ArxivClient {
  // Pass noCache so Cache is not constructed (avoids needing a real cacheDir).
  const client = new ArxivClient({ noCache: true });
  // Replace the internal api field — it is private but accessible via bracket notation in JS.
  (client as unknown as Record<string, unknown>)["api"] = ds;
  // Stub getPaper to return the fixture without a network call.
  vi.spyOn(client, "getPaper").mockResolvedValue(FIXTURE_PAPER);
  return client;
}

describe("ArxivClient.toBibTeX", () => {
  it("returns the canonical string verbatim when getText succeeds", async () => {
    const ds = makeDataSource(() => Promise.resolve(CANONICAL_BIBTEX));
    const client = makeClient(ds);
    const result = await client.toBibTeX("2310.06825");
    expect(result).toBe(CANONICAL_BIBTEX);
  });

  it("calls getText with the correct bibtex endpoint URL", async () => {
    const getTextSpy = vi.fn().mockResolvedValue(CANONICAL_BIBTEX);
    const ds = makeDataSource(getTextSpy);
    const client = makeClient(ds);
    await client.toBibTeX("2310.06825");
    expect(getTextSpy).toHaveBeenCalledWith(
      "https://arxiv.org/bibtex/2310.06825"
    );
  });

  it("falls back to generateBibTeX when getText throws", async () => {
    const ds = makeDataSource(() =>
      Promise.reject(new Error("network failure"))
    );
    const client = makeClient(ds);
    const result = await client.toBibTeX("2310.06825");
    const expected = generateBibTeX(FIXTURE_PAPER);
    expect(result).toBe(expected);
  });

  it("invokes getPaper with the original id string during fallback", async () => {
    const ds = makeDataSource(() =>
      Promise.reject(new Error("not found"))
    );
    const client = makeClient(ds);
    await client.toBibTeX("2310.06825");
    expect(client.getPaper).toHaveBeenCalledWith("2310.06825");
  });

  it("calls getText with old-style slash preserved in the URL", async () => {
    const getTextSpy = vi.fn().mockResolvedValue(CANONICAL_BIBTEX);
    const ds = makeDataSource(getTextSpy);
    const client = makeClient(ds);
    await client.toBibTeX("cond-mat/0011267");
    expect(getTextSpy).toHaveBeenCalledWith(
      "https://arxiv.org/bibtex/cond-mat/0011267"
    );
  });
});
