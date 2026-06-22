import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFeed } from "../../../src/core/parse/atom.js";

const fixture = (name: string): string =>
  readFileSync(join(__dirname, "..", "..", "fixtures", name), "utf8");

describe("parseFeed (single entry)", () => {
  const result = parseFeed(fixture("atom-single.xml"));

  it("maps OpenSearch paging fields", () => {
    expect(result.total).toBe(1);
    expect(result.start).toBe(0);
    expect(result.count).toBe(1);
  });

  it("wraps a single entry into a one-element papers array (isArray shape)", () => {
    expect(Array.isArray(result.papers)).toBe(true);
    expect(result.papers).toHaveLength(1);
  });

  it("derives canonical id, version, and idWithVersion from the entry id URL", () => {
    const p = result.papers[0];
    expect(p.id).toBe("2310.06825");
    expect(p.version).toBe(1);
    expect(p.idWithVersion).toBe("2310.06825v1");
  });

  it("trims title and summary", () => {
    const p = result.papers[0];
    expect(p.title).toBe("Mistral 7B");
    expect(p.summary).toBe(
      "We introduce Mistral 7B, a 7-billion-parameter language model.",
    );
  });

  it("maps authors with optional affiliation", () => {
    const p = result.papers[0];
    expect(p.authors).toEqual([
      { name: "Albert Q. Jiang", affiliation: "Mistral AI" },
      { name: "Alexandre Sablayrolles" },
    ]);
  });

  it("maps categories and primary category", () => {
    const p = result.papers[0];
    expect(p.categories).toEqual(["cs.CL", "cs.AI", "cs.LG"]);
    expect(p.primaryCategory).toBe("cs.CL");
  });

  it("carries published/updated and optional doi/journalRef/comment", () => {
    const p = result.papers[0];
    expect(p.published).toBe("2023-10-10T17:54:09Z");
    expect(p.updated).toBe("2023-10-10T17:54:09Z");
    expect(p.doi).toBe("10.1000/xyz123");
    expect(p.journalRef).toBe("Proc. of FooConf 2023");
    expect(p.comment).toBe("Models and code available");
  });

  it("maps abs and pdf links", () => {
    const p = result.papers[0];
    expect(p.links.abs).toBe("http://arxiv.org/abs/2310.06825v1");
    expect(p.links.pdf).toBe("http://arxiv.org/pdf/2310.06825v1");
  });
});

describe("parseFeed (multi entry)", () => {
  const result = parseFeed(fixture("atom-multi.xml"));

  it("maps paging and parses every entry", () => {
    expect(result.total).toBe(42);
    expect(result.papers).toHaveLength(2);
  });

  it("preserves document order", () => {
    expect(result.papers[0].id).toBe("2310.06825");
    expect(result.papers[1].id).toBe("cond-mat/0011267");
  });

  it("handles an old-style id (slash kept) with version", () => {
    const p = result.papers[1];
    expect(p.id).toBe("cond-mat/0011267");
    expect(p.version).toBe(2);
    expect(p.idWithVersion).toBe("cond-mat/0011267v2");
  });

  it("leaves optional fields undefined when absent", () => {
    const p = result.papers[1];
    expect(p.doi).toBeUndefined();
    expect(p.journalRef).toBeUndefined();
    expect(p.comment).toBeUndefined();
    expect(p.authors).toEqual([{ name: "Jane Doe" }]);
  });

  it("single-category entry still yields an array", () => {
    expect(result.papers[1].categories).toEqual(["cond-mat"]);
  });
});

describe("parseFeed (zero results)", () => {
  const empty = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">
  <opensearch:totalResults>0</opensearch:totalResults>
  <opensearch:startIndex>0</opensearch:startIndex>
  <opensearch:itemsPerPage>0</opensearch:itemsPerPage>
</feed>`;

  it("returns empty papers without throwing", () => {
    const result = parseFeed(empty);
    expect(result.total).toBe(0);
    expect(result.papers).toEqual([]);
  });
});
