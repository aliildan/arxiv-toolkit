import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parsePdf } from "../../../src/core/parse/pdf.js";

const here = dirname(fileURLToPath(import.meta.url));
const bytes = (): Uint8Array =>
  new Uint8Array(
    readFileSync(join(here, "..", "..", "fixtures", "sample.pdf")),
  );

describe("parsePdf", () => {
  it("returns a single best-effort section with the cleaned sentence", async () => {
    const res = await parsePdf(bytes());
    expect(res.sections).toHaveLength(1);
    expect(res.sections[0].title).toBe("Full text");
    expect(res.sections[0].level).toBe(1);
    expect(res.sections[0].id).toBeUndefined();
    expect(res.sections[0].content).toContain(
      "The quick brown fox studies super-symmetry.",
    );
    expect(res.warning).toBe(
      "PDF text extraction: single-section, no heading heuristics",
    );
  });

  it("collapses whitespace runs to single spaces", () => {
    // unit-level cleanup assertion via the exported helper
    return import("../../../src/core/parse/pdf.js").then(({ cleanupText }) => {
      expect(cleanupText("a   b\n\n  c")).toBe("a b c");
    });
  });

  it("de-hyphenates word-break hyphens across line breaks", () => {
    return import("../../../src/core/parse/pdf.js").then(({ cleanupText }) => {
      expect(cleanupText("super-\nsymmetry")).toBe("supersymmetry");
      // does NOT join a hyphen followed by an uppercase / non-letter
      expect(cleanupText("well-\nKnown")).toContain("well- Known");
    });
  });
});
