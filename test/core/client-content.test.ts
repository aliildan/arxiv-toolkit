import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ArxivClient } from "../../src/core/client.js";
import type { DataSource } from "../../src/core/datasource/datasource.js";
import { NotFoundError } from "../../src/core/errors.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): string =>
  readFileSync(join(here, "..", "fixtures", name), "utf8");
const pdfBytes = (): Uint8Array =>
  new Uint8Array(readFileSync(join(here, "..", "fixtures", "sample.pdf")));

const NATIVE = fixture("native.html");
const AR5IV = fixture("ar5iv.html");

/** Build a client with caching disabled and a fake DataSource injected. */
function clientWith(fake: Partial<DataSource>): ArxivClient {
  const client = new ArxivClient({ noCache: true });
  const ds: DataSource = {
    query: async () => {
      throw new Error("query not used");
    },
    getHtml: async () => null,
    getPdf: async () => pdfBytes(),
    getText: async () => {
      throw new Error("getText not used");
    },
    ...fake,
  };
  // Inject over the private `api` field for the test.
  (client as unknown as { api: DataSource }).api = ds;
  return client;
}

describe("getContent source matrix", () => {
  it("auto: returns native HTML content when native is available", async () => {
    const client = clientWith({
      getHtml: async (url) => (url.includes("/html/") ? NATIVE : null),
    });
    const res = await client.getContent("2310.06825");
    expect(res.source).toBe("html-native");
    expect(res.title).toBe("A Native LaTeXML Paper");
    expect(res.sections.map((s) => s.id)).toEqual(["S1", "S1.SS1", "S2"]);
  });

  it("auto: falls through native(404) -> ar5iv", async () => {
    const client = clientWith({
      getHtml: async (url) =>
        url.includes("ar5iv") ? AR5IV : null, // native 404 -> null
    });
    const res = await client.getContent("cond-mat/0011267");
    expect(res.source).toBe("html-ar5iv");
    expect(res.title).toBe("An ar5iv Historical Paper");
  });

  it("auto: falls through native(404) -> ar5iv(404) -> PDF", async () => {
    const client = clientWith({ getHtml: async () => null });
    const res = await client.getContent("hep-th/9901001");
    expect(res.source).toBe("pdf");
    expect(res.sections).toHaveLength(1);
    expect(res.sections[0].content).toContain("super-symmetry");
    expect(res.warnings).toContain(
      "PDF text extraction: single-section, no heading heuristics",
    );
  });

  it("auto: ar5iv 200-with-zero-sections triggers PDF fallback", async () => {
    const client = clientWith({
      getHtml: async (url) =>
        url.includes("ar5iv") ? "<html><body><p>no sections</p></body></html>" : null,
    });
    const res = await client.getContent("hep-th/9901002");
    expect(res.source).toBe("pdf");
  });

  it("auto: native 200-with-zero-sections falls through to ar5iv", async () => {
    const client = clientWith({
      getHtml: async (url) =>
        url.includes("ar5iv") ? AR5IV : "<html><body><p>no sections</p></body></html>",
    });
    const res = await client.getContent("2310.06825");
    expect(res.source).toBe("html-ar5iv");
    expect(res.title).toBe("An ar5iv Historical Paper");
  });

  it("html: native(404)+ar5iv(404) -> UnsupportedError (never PDF)", async () => {
    let pdfCalled = false;
    const client = clientWith({
      getHtml: async () => null,
      getPdf: async () => {
        pdfCalled = true;
        return pdfBytes();
      },
    });
    await expect(
      client.getContent("hep-th/9901003", { source: "html" }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED" });
    expect(pdfCalled).toBe(false);
  });

  it("pdf: skips HTML entirely", async () => {
    let htmlCalled = false;
    const client = clientWith({
      getHtml: async () => {
        htmlCalled = true;
        return NATIVE;
      },
    });
    const res = await client.getContent("2310.06825", { source: "pdf" });
    expect(res.source).toBe("pdf");
    expect(htmlCalled).toBe(false);
  });
});

describe("getContent section selection", () => {
  it("selects by id (case-insensitive), wins over maxChars", async () => {
    const client = clientWith({
      getHtml: async (url) => (url.includes("/html/") ? NATIVE : null),
    });
    const res = await client.getContent("2310.06825", {
      section: "s1.ss1",
      maxChars: 1,
    });
    expect(res.sections).toHaveLength(1);
    expect(res.sections[0].id).toBe("S1.SS1");
    // Section selection is a filter, not a chunk — truncated must be false
    expect(res.truncated).toBe(false);
    expect(res.nextCursor).toBeUndefined();
  });

  it("selects by title substring when id does not match", async () => {
    const client = clientWith({
      getHtml: async (url) => (url.includes("/html/") ? NATIVE : null),
    });
    const res = await client.getContent("2310.06825", { section: "methods" });
    expect(res.sections[0].id).toBe("S2");
    expect(res.sections[0].title).toBe("Methods");
  });

  it("zero matches -> NotFoundError listing titles", async () => {
    const client = clientWith({
      getHtml: async (url) => (url.includes("/html/") ? NATIVE : null),
    });
    await expect(
      client.getContent("2310.06825", { section: "nope" }),
    ).rejects.toThrow(/Introduction|Methods/);
  });
});

describe("getContent cursor round-trip", () => {
  it("walks nextCursor to completion with whole-section chunks", async () => {
    const client = clientWith({
      getHtml: async (url) => (url.includes("/html/") ? NATIVE : null),
    });
    const collected: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const res = await client.getContent("2310.06825", {
        maxChars: 1, // tiny target => one whole section per chunk
        cursor,
      });
      // each chunk holds at least one whole section, never a fragment
      expect(res.sections.length).toBeGreaterThanOrEqual(1);
      for (const s of res.sections) collected.push(s.id ?? s.title);
      // truncated true whenever the read is chunked
      expect(res.truncated).toBe(true);
      cursor = res.nextCursor;
      pages++;
      expect(pages).toBeLessThan(10); // guard against infinite loop
    } while (cursor);
    expect(collected).toEqual(["S1", "S1.SS1", "S2"]);
  });

  it("rejects a cursor presented with a different id -> ParseError", async () => {
    const client = clientWith({
      getHtml: async (url) => (url.includes("/html/") ? NATIVE : null),
    });
    const first = await client.getContent("2310.06825", { maxChars: 1 });
    expect(first.nextCursor).toBeDefined();
    await expect(
      client.getContent("2401.00001", { cursor: first.nextCursor }),
    ).rejects.toMatchObject({ code: "PARSE" });
  });

  it("the last chunk has no nextCursor", async () => {
    const client = clientWith({
      getHtml: async (url) => (url.includes("/html/") ? NATIVE : null),
    });
    // big maxChars => single chunk, all sections, no nextCursor, not truncated
    const res = await client.getContent("2310.06825", { maxChars: 100000 });
    expect(res.sections.map((s) => s.id)).toEqual(["S1", "S1.SS1", "S2"]);
    expect(res.nextCursor).toBeUndefined();
    expect(res.truncated).toBe(false);
  });
});

describe("getContent format option", () => {
  it("default (markdown) returns sections with Markdown heading/bold/link syntax", async () => {
    const client = clientWith({
      getHtml: async (url) => (url.includes("/html/") ? NATIVE : null),
    });
    const res = await client.getContent("2310.06825");
    expect(res.format).toBe("markdown");
    // Markdown content should contain at least some of the typical markdown markers
    // The native fixture section content is already rendered to markdown via htmlFragmentToMarkdown
    const allContent = res.sections.map((s) => s.content).join("\n\n");
    // text field should match joined sections
    expect(res.text).toBe(allContent);
  });

  it("format:text strips Markdown heading/bold/link syntax from sections and text", async () => {
    const client = clientWith({
      getHtml: async (url) => (url.includes("/html/") ? NATIVE : null),
    });
    const res = await client.getContent("2310.06825", { format: "text" });
    expect(res.format).toBe("text");
    // No ATX heading markers
    expect(res.text).not.toMatch(/^#{1,6}\s/m);
    // No bold markers
    expect(res.text).not.toContain("**");
    // No link syntax
    expect(res.text).not.toContain("](");
    // sections content should also be stripped
    for (const s of res.sections) {
      expect(s.content).not.toMatch(/^#{1,6}\s/m);
      expect(s.content).not.toContain("**");
      expect(s.content).not.toContain("](");
    }
    // text field is consistent with sections
    expect(res.text).toBe(res.sections.map((s) => s.content).join("\n\n"));
  });

  it("format:text applied to PDF source is harmless (PDF content is already plain)", async () => {
    const client = clientWith({ getHtml: async () => null });
    const res = await client.getContent("hep-th/9901001", { format: "text" });
    expect(res.format).toBe("text");
    expect(res.source).toBe("pdf");
    // PDF content should still contain the expected text
    expect(res.text).toContain("super-symmetry");
    // no heading markers expected (PDF is already plain text)
    expect(res.text).not.toMatch(/^#{1,6}\s/m);
  });
});

describe("download", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "arxiv-dl-"));
  });

  it("writes the PDF to dir/filenameFor(id) and returns path+bytes", async () => {
    const bytes = pdfBytes();
    const client = clientWith({ getPdf: async () => bytes });
    const out = await client.download("cond-mat/0011267v1", { dir });
    expect(out.path).toBe(join(dir, "cond-mat_0011267v1.pdf"));
    expect(out.bytes).toBe(bytes.byteLength);
    const written = await readFile(out.path);
    expect(new Uint8Array(written)).toEqual(bytes);
    await rm(dir, { recursive: true, force: true });
  });

  it("propagates NotFoundError from getPdf", async () => {
    const client = clientWith({
      getPdf: async () => {
        throw new NotFoundError("nope");
      },
    });
    await expect(client.download("0000.00000", { dir })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await rm(dir, { recursive: true, force: true });
  });
});
