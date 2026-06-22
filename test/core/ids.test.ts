import { describe, it, expect } from "vitest";
import {
  normalizeId,
  absUrl,
  htmlUrl,
  ar5ivUrl,
  pdfUrl,
  bibtexUrl,
  filenameFor,
} from "../../src/core/ids.js";

describe("normalizeId", () => {
  it("parses new-style ids without version", () => {
    expect(normalizeId("2310.06825")).toEqual({
      id: "2310.06825",
      version: undefined,
      idWithVersion: undefined,
    });
  });

  it("parses new-style ids with version", () => {
    expect(normalizeId("2310.06825v3")).toEqual({
      id: "2310.06825",
      version: 3,
      idWithVersion: "2310.06825v3",
    });
  });

  it("parses old-style ids without version (keeps slash)", () => {
    expect(normalizeId("cond-mat/0011267")).toEqual({
      id: "cond-mat/0011267",
      version: undefined,
      idWithVersion: undefined,
    });
  });

  it("parses old-style ids with subject class and version", () => {
    expect(normalizeId("math.GT/0309136v2")).toEqual({
      id: "math.GT/0309136",
      version: 2,
      idWithVersion: "math.GT/0309136v2",
    });
  });

  it("strips /abs/ prefix", () => {
    expect(normalizeId("https://arxiv.org/abs/2310.06825v1")).toEqual({
      id: "2310.06825",
      version: 1,
      idWithVersion: "2310.06825v1",
    });
  });

  it("strips /html/ prefix", () => {
    expect(normalizeId("https://arxiv.org/html/cond-mat/0011267")).toEqual({
      id: "cond-mat/0011267",
      version: undefined,
      idWithVersion: undefined,
    });
  });

  it("strips /pdf/ prefix and optional .pdf suffix", () => {
    expect(normalizeId("https://arxiv.org/pdf/2310.06825v2.pdf")).toEqual({
      id: "2310.06825",
      version: 2,
      idWithVersion: "2310.06825v2",
    });
  });

  it("strips ar5iv host and path", () => {
    expect(normalizeId("https://ar5iv.labs.arxiv.org/html/2310.06825")).toEqual({
      id: "2310.06825",
      version: undefined,
      idWithVersion: undefined,
    });
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeId("  2310.06825v1  ")).toEqual({
      id: "2310.06825",
      version: 1,
      idWithVersion: "2310.06825v1",
    });
  });

  it("is case-insensitive for the arxiv host but keeps subject class case in id", () => {
    expect(normalizeId("HTTPS://ARXIV.ORG/ABS/math.GT/0309136")).toEqual({
      id: "math.GT/0309136",
      version: undefined,
      idWithVersion: undefined,
    });
  });

  it.each([
    "",
    "   ",
    "not-an-id",
    "2310.06", // too few digits after dot
    "2310.068256", // too many digits after dot
    "12345.06825", // too many digits before dot
    "cond-mat/001126", // too few digits old style
    "COND-MAT/0011267", // old-style subject class must be lowercase
    "math.gt/0309136", // subject class suffix must be uppercase
    "v1",
    "https://arxiv.org/abs/",
    "https://example.com/2310.06825",
  ])("throws on invalid input %p", (input) => {
    expect(() => normalizeId(input)).toThrow();
  });
});

describe("url builders keep slash in old-style ids", () => {
  it("absUrl for new-style unversioned", () => {
    expect(absUrl(normalizeId("2310.06825"))).toBe(
      "https://arxiv.org/abs/2310.06825",
    );
  });
  it("absUrl for new-style versioned", () => {
    expect(absUrl(normalizeId("2310.06825v3"))).toBe(
      "https://arxiv.org/abs/2310.06825v3",
    );
  });
  it("absUrl for old-style keeps slash (not %2F)", () => {
    expect(absUrl(normalizeId("cond-mat/0011267"))).toBe(
      "https://arxiv.org/abs/cond-mat/0011267",
    );
  });
  it("htmlUrl for old-style versioned keeps slash", () => {
    expect(htmlUrl(normalizeId("cond-mat/0011267v1"))).toBe(
      "https://arxiv.org/html/cond-mat/0011267v1",
    );
  });
  it("ar5ivUrl keeps slash", () => {
    expect(ar5ivUrl(normalizeId("cond-mat/0011267"))).toBe(
      "https://ar5iv.labs.arxiv.org/html/cond-mat/0011267",
    );
  });
  it("pdfUrl appends .pdf for unversioned", () => {
    expect(pdfUrl(normalizeId("2310.06825"))).toBe(
      "https://arxiv.org/pdf/2310.06825.pdf",
    );
  });
  it("pdfUrl for versioned new-style", () => {
    expect(pdfUrl(normalizeId("2310.06825v2"))).toBe(
      "https://arxiv.org/pdf/2310.06825v2.pdf",
    );
  });
  it("pdfUrl keeps slash for old-style", () => {
    expect(pdfUrl(normalizeId("cond-mat/0011267"))).toBe(
      "https://arxiv.org/pdf/cond-mat/0011267.pdf",
    );
  });
  it("bibtexUrl keeps slash", () => {
    expect(bibtexUrl(normalizeId("math.GT/0309136v2"))).toBe(
      "https://arxiv.org/bibtex/math.GT/0309136v2",
    );
  });
});

describe("filenameFor replaces slash with underscore", () => {
  it("new-style unversioned", () => {
    expect(filenameFor(normalizeId("2310.06825"))).toBe("2310.06825.pdf");
  });
  it("new-style versioned appends v{n}", () => {
    expect(filenameFor(normalizeId("2310.06825v3"))).toBe(
      "2310.06825v3.pdf",
    );
  });
  it("old-style unversioned: slash -> underscore", () => {
    expect(filenameFor(normalizeId("cond-mat/0011267"))).toBe(
      "cond-mat_0011267.pdf",
    );
  });
  it("old-style versioned with subject class: slash -> underscore", () => {
    expect(filenameFor(normalizeId("math.GT/0309136v2"))).toBe(
      "math.GT_0309136v2.pdf",
    );
  });
});
