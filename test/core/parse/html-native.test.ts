import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { parseNativeHtml } from "../../../src/core/parse/html-native.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): string =>
  readFileSync(join(here, "..", "..", "fixtures", name), "utf8");

describe("parseNativeHtml", () => {
  let result: ReturnType<typeof parseNativeHtml>;
  beforeAll(() => {
    result = parseNativeHtml(fixture("native.html"));
  });

  it("extracts the document title", () => {
    expect(result.title).toBe("A Native LaTeXML Paper");
  });

  it("extracts the abstract with math preserved and heading stripped", () => {
    expect(result.abstract).toBeDefined();
    expect(result.abstract).toContain("$x > 0$");
    expect(result.abstract).not.toContain("Abstract");
  });

  it("flattens sections and subsections in document order with ids and levels", () => {
    const ids = result.sections.map((s) => s.id);
    expect(ids).toEqual(["S1", "S1.SS1", "S2"]);
    const titles = result.sections.map((s) => s.title);
    expect(titles).toEqual(["Introduction", "Background", "Methods"]);
    const levels = result.sections.map((s) => s.level);
    expect(levels).toEqual([1, 2, 1]);
  });

  it("does not duplicate subsection text inside its parent section content", () => {
    const intro = result.sections.find((s) => s.id === "S1")!;
    expect(intro.content).toContain("$E = mc^2$");
    expect(intro.content).not.toContain("Prior work"); // lives in S1.SS1 only
  });

  it("preserves the footnote marker and citation in content", () => {
    const intro = result.sections.find((s) => s.id === "S1")!;
    expect(intro.content).toContain("[1]");
    const bg = result.sections.find((s) => s.id === "S1.SS1")!;
    expect(bg.content).toContain("Smith 2019");
  });

  it("converts a GFM table inside a section", () => {
    const methods = result.sections.find((s) => s.id === "S2")!;
    expect(methods.content).toContain("| Param | Value |");
    expect(methods.content).toContain("| lr | 0.01 |");
  });
});
