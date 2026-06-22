import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ArxivClient } from "../../src/core/client.js";
import type { DataSource } from "../../src/core/datasource/datasource.js";

const fixture = (name: string): string =>
  readFileSync(join(__dirname, "..", "fixtures", name), "utf8");

interface Captured {
  urls: string[];
}

/** Build a client whose ApiDataSource is replaced by a fake that records query
 * URLs and returns the given Atom feeds in sequence (one per query call). */
function clientWithFeeds(feeds: string[]): { client: ArxivClient; cap: Captured } {
  const cap: Captured = { urls: [] };
  const client = new ArxivClient({ noCache: true, defaultMaxResults: 25 });
  let i = 0;
  const fake: DataSource = {
    async query(url: string) {
      cap.urls.push(url);
      const feed = feeds[Math.min(i, feeds.length - 1)];
      i++;
      return feed;
    },
    async getHtml() {
      return null;
    },
    async getPdf() {
      return new Uint8Array();
    },
    async getText() {
      return "";
    },
  };
  // Inject the fake over the private `api` field.
  (client as unknown as { api: DataSource }).api = fake;
  return { client, cap };
}

describe("ArxivClient.search query building", () => {
  it("emits all:<query> for a free-text query", async () => {
    const { client, cap } = clientWithFeeds([fixture("atom-single.xml")]);
    await client.search({ query: "mistral" });
    expect(cap.urls[0]).toContain("search_query=all:%22mistral%22");
    expect(cap.urls[0]).toContain("start=0");
    expect(cap.urls[0]).toContain("max_results=25");
  });

  it("ANDs free-text with field clauses and quotes multi-word terms", async () => {
    const { client, cap } = clientWithFeeds([fixture("atom-single.xml")]);
    await client.search({ query: "language model", author: "Jiang", category: "cs.CL" });
    const url = cap.urls[0];
    expect(url).toContain("all:%22language+model%22");
    expect(url).toContain("au:%22Jiang%22");
    expect(url).toContain("cat:%22cs.CL%22");
    expect(url).toContain("+AND+");
  });

  it("clamps maxResults to 2000", async () => {
    const { client, cap } = clientWithFeeds([fixture("atom-single.xml")]);
    await client.search({ query: "x", maxResults: 9999 });
    expect(cap.urls[0]).toContain("max_results=2000");
  });

  it("uses cfg.defaultMaxResults when maxResults omitted", async () => {
    const cap: Captured = { urls: [] };
    const client = new ArxivClient({ noCache: true, defaultMaxResults: 7 });
    const fake: DataSource = {
      async query(url: string) {
        cap.urls.push(url);
        return fixture("atom-single.xml");
      },
      async getHtml() { return null; },
      async getPdf() { return new Uint8Array(); },
      async getText() { return ""; },
    };
    (client as unknown as { api: DataSource }).api = fake;
    await client.search({ query: "x" });
    expect(cap.urls[0]).toContain("max_results=7");
  });

  it("applies sortBy/sortOrder/start", async () => {
    const { client, cap } = clientWithFeeds([fixture("atom-single.xml")]);
    await client.search({ query: "x", sortBy: "submittedDate", sortOrder: "ascending", start: 50 });
    const url = cap.urls[0];
    expect(url).toContain("sortBy=submittedDate");
    expect(url).toContain("sortOrder=ascending");
    expect(url).toContain("start=50");
  });

  it("throws ParseError when neither query, field, nor ids are given", async () => {
    const { client } = clientWithFeeds([fixture("atom-single.xml")]);
    await expect(client.search({})).rejects.toMatchObject({ code: "PARSE" });
  });

  it("allows an ids-only search (id_list, no search_query)", async () => {
    const { client, cap } = clientWithFeeds([fixture("atom-single.xml")]);
    await client.search({ ids: ["2310.06825"] });
    const url = cap.urls[0];
    expect(url).toContain("id_list=2310.06825");
    expect(url).not.toContain("search_query=");
  });

  it("keeps the literal slash in old-style id_list (no %2F)", async () => {
    const { client, cap } = clientWithFeeds([fixture("atom-multi.xml")]);
    await client.search({ ids: ["cond-mat/0011267"] });
    expect(cap.urls[0]).toContain("id_list=cond-mat/0011267");
    expect(cap.urls[0]).not.toContain("%2F");
  });

  it("parses the feed into a SearchResult", async () => {
    const { client } = clientWithFeeds([fixture("atom-single.xml")]);
    const res = await client.search({ query: "mistral" });
    expect(res.total).toBe(1);
    expect(res.papers[0].id).toBe("2310.06825");
  });
});

describe("ArxivClient.search hints", () => {
  it("pushes a hint when total > 1000", async () => {
    const big = fixture("atom-single.xml").replace(
      ">1</opensearch:totalResults>",
      ">1200</opensearch:totalResults>",
    );
    const { client } = clientWithFeeds([big]);
    const res = await client.search({ query: "transformer" });
    expect(res.total).toBe(1200);
    expect(res.hints?.[0]).toMatch(/narrow/i);
  });

  it("omits hints when total <= 1000", async () => {
    const { client } = clientWithFeeds([fixture("atom-single.xml")]);
    const res = await client.search({ query: "mistral" });
    expect(res.hints).toBeUndefined();
  });
});

describe("ArxivClient.recent", () => {
  it("maps to a submittedDate/descending category search", async () => {
    const { client, cap } = clientWithFeeds([fixture("atom-multi.xml")]);
    await client.recent("cs.CL", { maxResults: 10 });
    const url = cap.urls[0];
    expect(url).toContain("cat:%22cs.CL%22");
    expect(url).toContain("sortBy=submittedDate");
    expect(url).toContain("sortOrder=descending");
    expect(url).toContain("max_results=10");
  });
});

describe("ArxivClient.getPaper(s)", () => {
  it("getPaper returns the single matching Paper", async () => {
    const { client } = clientWithFeeds([fixture("atom-single.xml")]);
    const paper = await client.getPaper("2310.06825");
    expect(paper.id).toBe("2310.06825");
    expect(paper.title).toBe("Mistral 7B");
  });

  it("getPapers returns papers in input order", async () => {
    // atom-multi has 2310.06825 then cond-mat/0011267; request reversed order.
    const { client } = clientWithFeeds([fixture("atom-multi.xml")]);
    const papers = await client.getPapers(["cond-mat/0011267", "2310.06825"]);
    expect(papers.map((p) => p.id)).toEqual(["cond-mat/0011267", "2310.06825"]);
  });

  it("getPapers warns about omitted ids without throwing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { client } = clientWithFeeds([fixture("atom-single.xml")]);
    const papers = await client.getPapers(["2310.06825", "9999.99999"]);
    expect(papers.map((p) => p.id)).toEqual(["2310.06825"]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("getPapers batches into <=50-id requests", async () => {
    const ids = Array.from({ length: 120 }, (_, i) => `2310.${String(10000 + i)}`);
    const cap: Captured = { urls: [] };
    const client = new ArxivClient({ noCache: true });
    const fake: DataSource = {
      async query(url: string) {
        cap.urls.push(url);
        // empty feed (no entries) — we only assert the batching, not the contents
        return `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><opensearch:totalResults xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">0</opensearch:totalResults><opensearch:startIndex xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">0</opensearch:startIndex><opensearch:itemsPerPage xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">0</opensearch:itemsPerPage></feed>`;
      },
      async getHtml() { return null; },
      async getPdf() { return new Uint8Array(); },
      async getText() { return ""; },
    };
    (client as unknown as { api: DataSource }).api = fake;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await client.getPapers(ids);
    warn.mockRestore();
    expect(cap.urls).toHaveLength(3); // 50 + 50 + 20
    expect(cap.urls[0]).toContain("max_results=50");
  });
});

describe("ArxivClient stubs", () => {
  it("toBibTeX throws its phase marker (Phase 7 pending)", async () => {
    const { client } = clientWithFeeds([fixture("atom-single.xml")]);
    await expect(client.toBibTeX("2310.06825")).rejects.toThrow("Phase 7");
  });
});
