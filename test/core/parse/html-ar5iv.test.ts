import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseAr5ivHtml } from "../../../src/core/parse/html-ar5iv.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): string =>
  readFileSync(join(here, "..", "..", "fixtures", name), "utf8");

describe("parseAr5ivHtml", () => {
  let result: ReturnType<typeof parseAr5ivHtml>;
  beforeAll(() => {
    result = parseAr5ivHtml(fixture("ar5iv.html"));
  });

  it("extracts the title from h1.title.mathjax", () => {
    expect(result.title).toBe("An ar5iv Historical Paper");
  });

  it("extracts the abstract with math preserved and heading stripped", () => {
    expect(result.abstract).toBeDefined();
    expect(result.abstract).toContain("$a \\le b$");
    expect(result.abstract).not.toContain("Abstract");
  });

  it("flattens sections and subsections in document order", () => {
    expect(result.sections.map((s) => s.id)).toEqual(["S1", "S1.SS1", "S2"]);
    expect(result.sections.map((s) => s.title)).toEqual([
      "Overview",
      "Details",
      "Results",
    ]);
    expect(result.sections.map((s) => s.level)).toEqual([1, 2, 1]);
  });

  it("preserves the footnote marker and citation", () => {
    const overview = result.sections.find((s) => s.id === "S1")!;
    expect(overview.content).toContain("[2]");
    expect(overview.content).not.toContain("Details cite"); // in S1.SS1 only
    const details = result.sections.find((s) => s.id === "S1.SS1")!;
    expect(details.content).toContain("Jones 2001");
  });
});
