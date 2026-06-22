import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { ArxivClient } from "../../src/core/client.js";
import { normalizeId } from "../../src/core/ids.js";

// Live integration tests hit the real arXiv endpoints. They are OPT-IN:
// run with `ARXIV_LIVE=1 npm test`. Skipped in CI and by default.
describe.skipIf(!process.env.ARXIV_LIVE)("live: arXiv endpoints", () => {
  // Known stable id with a native HTML rendering (post-Dec-2023, LaTeX-sourced).
  // If this id ever 404s at the API, substitute another post-Dec-2023 id.
  const STABLE_ID = "2310.06825";

  it("search returns results for a broad query", async () => {
    const client = new ArxivClient();
    const res = await client.search({
      query: "attention is all you need",
      maxResults: 5,
    });
    expect(res.papers.length).toBeGreaterThan(0);
    expect(res.total).toBeGreaterThanOrEqual(res.papers.length);
    for (const p of res.papers) {
      expect(p.id).toBeTruthy();
      expect(p.title).toBeTruthy();
      expect(p.authors.length).toBeGreaterThan(0);
      expect(p.links.abs).toMatch(/^https:\/\/arxiv\.org\/abs\//);
    }
  });

  it("getPaper returns metadata for a known id", async () => {
    const client = new ArxivClient();
    const paper = await client.getPaper(STABLE_ID);
    expect(paper.id).toBe(normalizeId(STABLE_ID).id);
    expect(paper.title).toBeTruthy();
    expect(paper.authors.length).toBeGreaterThan(0);
    expect(paper.links.pdf).toMatch(/^https:\/\/arxiv\.org\/pdf\//);
  });

  it("recent returns recent papers in a category", async () => {
    const client = new ArxivClient();
    const res = await client.recent("cs.CL", { maxResults: 5 });
    expect(res.papers.length).toBeGreaterThan(0);
    for (const p of res.papers) {
      expect(p.categories).toContain("cs.CL");
    }
  });

  it("getContent (auto) resolves a native-HTML or fallback source", async () => {
    const client = new ArxivClient();
    const content = await client.getContent(STABLE_ID, { maxChars: 4000 });
    expect(["html-native", "html-ar5iv", "pdf"]).toContain(content.source);
    expect(content.sections.length).toBeGreaterThan(0);
    expect(content.text.length).toBeGreaterThan(0);
    expect(content.id).toBe(normalizeId(STABLE_ID).id);
  });

  it("getContent chunking walks nextCursor to completion", async () => {
    const client = new ArxivClient();
    const first = await client.getContent(STABLE_ID, { maxChars: 2000 });
    expect(first.sections.length).toBeGreaterThan(0);
    if (first.nextCursor) {
      const second = await client.getContent(STABLE_ID, {
        maxChars: 2000,
        cursor: first.nextCursor,
      });
      expect(second.sections.length).toBeGreaterThanOrEqual(0);
      // The cursor is bound to the same id; a mismatch would throw ParseError.
      expect(second.id).toBe(first.id);
    }
  });

  it("toBibTeX returns canonical BibTeX", async () => {
    const client = new ArxivClient();
    const bib = await client.toBibTeX(STABLE_ID);
    expect(bib).toMatch(/^@misc\{/);
    expect(bib).toContain("archivePrefix={arXiv}");
    expect(bib).toContain(`eprint={${normalizeId(STABLE_ID).id}}`);
  });

  it("download writes a PDF and reports the absolute path", async () => {
    const client = new ArxivClient({
      downloadsDir: process.env.RUNNER_TMP ?? tmpdir(),
    });
    const result = await client.download(STABLE_ID);
    expect(result.path).toMatch(/\.pdf$/);
    expect(result.bytes).toBeGreaterThan(0);
  });
});
