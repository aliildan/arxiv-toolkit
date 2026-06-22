import { describe, it, expect } from "vitest";
import gfmPkg from "turndown-plugin-gfm";
import TurndownService from "turndown";
import {
  makeTurndown,
  htmlFragmentToMarkdown,
  markdownToText,
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

describe("markdownToText", () => {
  it("strips ATX headings and preserves heading text", () => {
    const md = "## Introduction\n\nSome text.";
    const text = markdownToText(md);
    expect(text).not.toContain("#");
    expect(text).toContain("Introduction");
    expect(text).toContain("Some text.");
  });

  it("strips bold markers and preserves content", () => {
    const md = "This is **bold** text and __also bold__.";
    const text = markdownToText(md);
    expect(text).not.toContain("**");
    expect(text).not.toContain("__");
    expect(text).toContain("bold");
  });

  it("strips italic markers and preserves content", () => {
    const md = "This is *italic* and _also italic_.";
    const text = markdownToText(md);
    expect(text).not.toContain("*italic*");
    expect(text).not.toContain("_also italic_");
    expect(text).toContain("italic");
  });

  it("converts links to link text only", () => {
    const md = "See [the paper](http://arxiv.org/abs/1234) for details.";
    const text = markdownToText(md);
    expect(text).not.toContain("](");
    expect(text).not.toContain("http://arxiv.org");
    expect(text).toContain("the paper");
  });

  it("converts images to alt text", () => {
    const md = "![Figure 1](http://example.com/fig1.png)";
    const text = markdownToText(md);
    expect(text).not.toContain("![");
    expect(text).toContain("Figure 1");
  });

  it("strips unordered list markers and keeps item text", () => {
    const md = "- item one\n- item two\n* item three";
    const text = markdownToText(md);
    expect(text).not.toMatch(/^[-*]\s/m);
    expect(text).toContain("item one");
    expect(text).toContain("item two");
    expect(text).toContain("item three");
  });

  it("strips ordered list markers and keeps item text", () => {
    const md = "1. first\n2. second\n3. third";
    const text = markdownToText(md);
    expect(text).not.toMatch(/^\d+\.\s/m);
    expect(text).toContain("first");
    expect(text).toContain("second");
  });

  it("strips inline code backticks", () => {
    const md = "Use `npm install` to install.";
    const text = markdownToText(md);
    expect(text).not.toContain("`");
    expect(text).toContain("npm install");
  });

  it("strips blockquote prefixes", () => {
    const md = "> This is a quote.\n> Second line.";
    const text = markdownToText(md);
    expect(text).not.toContain("> ");
    expect(text).toContain("This is a quote.");
  });

  it("handles a mixed sample with heading, bold, link, and list item", () => {
    const md = "## Results\n\n**Key finding**: see [paper](http://x.com).\n\n- item one";
    const text = markdownToText(md);
    expect(text).not.toContain("#");
    expect(text).not.toContain("**");
    expect(text).not.toContain("](");
    expect(text).not.toMatch(/^-\s/m);
    expect(text).toContain("Results");
    expect(text).toContain("Key finding");
    expect(text).toContain("paper");
    expect(text).toContain("item one");
  });

  it("leaves math $…$ and $$…$$ intact", () => {
    const md = "Energy $E = mc^2$ and\n\n$$\\int_0^1 x\\,dx = \\frac{1}{2}$$";
    const text = markdownToText(md);
    expect(text).toContain("$E = mc^2$");
    expect(text).toContain("$$\\int_0^1 x\\,dx = \\frac{1}{2}$$");
  });

  it("does not hang on a line with many lone asterisks (backtracking guard)", () => {
    // 50 lone asterisks — with a catastrophic (.+?) regex this would hang
    const md = "*".repeat(50) + " some text";
    const start = Date.now();
    const text = markdownToText(md);
    const elapsed = Date.now() - start;
    // Must complete in under 1000ms (real catastrophic backtracking takes minutes)
    expect(elapsed).toBeLessThan(1000);
    // Lone unpaired asterisks should be preserved (no stripping of unmatched markers)
    expect(text).toContain("*");
  });

  it("collapses excess blank lines", () => {
    const md = "line one\n\n\n\nline two";
    const text = markdownToText(md);
    expect(text).not.toMatch(/\n{3,}/);
    expect(text).toContain("line one");
    expect(text).toContain("line two");
  });
});
