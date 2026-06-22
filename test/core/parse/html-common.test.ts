import { describe, it, expect } from "vitest";
import gfmPkg from "turndown-plugin-gfm";
import TurndownService from "turndown";
import {
  makeTurndown,
  htmlFragmentToMarkdown,
} from "../../../src/core/parse/html-common.js";

describe("turndown-plugin-gfm ESM interop (smoke test)", () => {
  it("exposes gfm as a callable plugin off the CJS default import", () => {
    // This is the regression guard (§15): the plugin is CJS; the default import
    // is the namespace and `gfm` is a property. `use()` must accept it.
    const { gfm } = gfmPkg;
    expect(typeof gfm).toBe("function");
    const td = new TurndownService();
    expect(() => td.use(gfm)).not.toThrow();
  });
});

describe("htmlFragmentToMarkdown", () => {
  it("converts a GFM table via the plugin", () => {
    const html =
      "<table><thead><tr><th>A</th><th>B</th></tr></thead>" +
      "<tbody><tr><td>1</td><td>2</td></tr></tbody></table>";
    const md = htmlFragmentToMarkdown(html);
    expect(md).toContain("| A | B |");
    expect(md).toContain("| 1 | 2 |");
    expect(md).toMatch(/\| --- \| --- \|/);
  });

  it("preserves inline math as $…$ from the TeX annotation", () => {
    const html =
      '<p>Energy <math display="inline"><semantics>' +
      '<mrow><mi>E</mi><mo>=</mo><mi>m</mi><msup><mi>c</mi><mn>2</mn></msup></mrow>' +
      '<annotation encoding="application/x-tex">E = mc^2</annotation>' +
      "</semantics></math> follows.</p>";
    const md = htmlFragmentToMarkdown(html);
    expect(md).toContain("$E = mc^2$");
    expect(md).not.toContain("<math");
    expect(md).not.toContain("annotation");
  });

  it("preserves display math as $$…$$ from the TeX annotation", () => {
    const html =
      '<math display="block"><semantics><mrow><mi>x</mi></mrow>' +
      '<annotation encoding="application/x-tex">\\int_0^1 x\\,dx</annotation>' +
      "</semantics></math>";
    const md = htmlFragmentToMarkdown(html);
    expect(md).toContain("$$\\int_0^1 x\\,dx$$");
  });

  it("falls back to math text content when no TeX annotation is present", () => {
    const html = '<math display="inline"><mi>y</mi></math>';
    const md = htmlFragmentToMarkdown(html);
    expect(md).toContain("$y$");
  });

  it("renders a footnote/citation sup-link as a bracketed marker", () => {
    const html = '<p>claim<sup id="fnref1"><a href="#fn1">3</a></sup>.</p>';
    const md = htmlFragmentToMarkdown(html);
    expect(md).toContain("claim[3]");
  });

  it("renders a bare superscript with a caret marker", () => {
    const html = "<p>10<sup>3</sup> joules</p>";
    const md = htmlFragmentToMarkdown(html);
    expect(md).toContain("10^3");
  });

  it("unwraps <cite> to its inner text", () => {
    const html = "<p>see <cite>Smith 2020</cite></p>";
    const md = htmlFragmentToMarkdown(html);
    expect(md).toContain("see Smith 2020");
    expect(md).not.toContain("<cite");
  });

  it("reuses an injected TurndownService instance", () => {
    const td = makeTurndown();
    const a = htmlFragmentToMarkdown("<p>one</p>", td);
    const b = htmlFragmentToMarkdown("<p>two</p>", td);
    expect(a).toBe("one");
    expect(b).toBe("two");
  });
});
