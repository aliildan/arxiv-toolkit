import { describe, it, expect } from "vitest";
import { generateBibTeX } from "../../src/core/bibtex.js";
import type { Paper } from "../../src/core/types.js";

// Minimal Paper fixture for testing — only fields generateBibTeX reads.
function makePaper(overrides: Partial<Paper> = {}): Paper {
  return {
    id: "2310.06825",
    title: "Attention Is All You Need",
    summary: "We propose a new simple network architecture, the Transformer.",
    authors: [
      { name: "Ashish Vaswani" },
      { name: "Noam Shazeer" },
      { name: "Niki Parmar" },
    ],
    categories: ["cs.CL", "cs.AI"],
    primaryCategory: "cs.CL",
    published: "2017-06-12T00:00:00Z",
    updated: "2017-06-12T00:00:00Z",
    links: {
      abs: "https://arxiv.org/abs/2310.06825",
      pdf: "https://arxiv.org/pdf/2310.06825",
    },
    ...overrides,
  };
}

describe("generateBibTeX", () => {
  it("produces the correct @misc template for a new-style id without doi", () => {
    const paper = makePaper();
    const bib = generateBibTeX(paper);
    const expected =
      "@misc{vaswani2017attention,\n" +
      "        title={Attention Is All You Need},\n" +
      "        author={Ashish Vaswani and Noam Shazeer and Niki Parmar},\n" +
      "        year={2017},\n" +
      "        eprint={2310.06825},\n" +
      "        archivePrefix={arXiv},\n" +
      "        primaryClass={cs.CL},\n" +
      "        url={https://arxiv.org/abs/2310.06825},\n" +
      "}";
    expect(bib).toBe(expected);
  });

  it("includes doi field when paper.doi is present", () => {
    const paper = makePaper({ doi: "10.48550/arXiv.2310.06825" });
    const bib = generateBibTeX(paper);
    expect(bib).toContain(
      "        url={https://arxiv.org/abs/2310.06825},\n" +
        "        doi={10.48550/arXiv.2310.06825},\n"
    );
    expect(bib.endsWith("}")).toBe(true);
  });

  it("omits doi field when paper.doi is undefined", () => {
    const paper = makePaper();
    const bib = generateBibTeX(paper);
    expect(bib).not.toContain("doi=");
  });

  it("omits doi field when paper.doi is empty string", () => {
    const paper = makePaper({ doi: "" });
    const bib = generateBibTeX(paper);
    expect(bib).not.toContain("doi=");
  });

  it("keeps the slash verbatim in old-style eprint ids", () => {
    const paper = makePaper({
      id: "cond-mat/0011267",
      authors: [{ name: "J. Doe" }],
      published: "2000-11-01T00:00:00Z",
      title: "Some Paper Title",
      primaryCategory: "cond-mat",
      links: {
        abs: "https://arxiv.org/abs/cond-mat/0011267",
        pdf: "https://arxiv.org/pdf/cond-mat/0011267",
      },
    });
    const bib = generateBibTeX(paper);
    expect(bib).toContain("eprint={cond-mat/0011267}");
    expect(bib).toContain("url={https://arxiv.org/abs/cond-mat/0011267}");
  });

  it("builds the key from last token of first author name, year, first alphabetic title word", () => {
    // "J. Doe" → last token "Doe" → "doe"; year "2000"; first alpha title word "some"
    const paper = makePaper({
      id: "cond-mat/0011267",
      authors: [{ name: "J. Doe" }],
      published: "2000-11-01T00:00:00Z",
      title: "Some Paper Title",
      primaryCategory: "cond-mat",
      links: {
        abs: "https://arxiv.org/abs/cond-mat/0011267",
        pdf: "https://arxiv.org/pdf/cond-mat/0011267",
      },
    });
    const bib = generateBibTeX(paper);
    expect(bib.startsWith("@misc{doe2000some,")).toBe(true);
  });

  it("strips non-alphanumeric characters from the first title word in the key", () => {
    // title begins with a non-word token then a real word
    const paper = makePaper({
      title: "100% Accurate: A Study",
      authors: [{ name: "Alice Smith" }],
      published: "2021-03-15T00:00:00Z",
    });
    const bib = generateBibTeX(paper);
    // "100%" — contains digits and %, first alphabetic char is none; next token "Accurate" has alpha
    // firstTitleWord = "accurate" (non-alphanumeric stripped = "accurate")
    expect(bib.startsWith("@misc{smith2021accurate,")).toBe(true);
  });

  it("and-joins authors", () => {
    const paper = makePaper({
      authors: [{ name: "Alice Smith" }, { name: "Bob Jones" }],
    });
    const bib = generateBibTeX(paper);
    expect(bib).toContain("author={Alice Smith and Bob Jones}");
  });

  it("uses a single author without 'and'", () => {
    const paper = makePaper({
      authors: [{ name: "Alice Smith" }],
    });
    const bib = generateBibTeX(paper);
    expect(bib).toContain("author={Alice Smith}");
  });

  it("extracts the year from the ISO published string", () => {
    const paper = makePaper({ published: "2023-10-10T00:00:00Z" });
    const bib = generateBibTeX(paper);
    expect(bib).toContain("year={2023}");
  });

  it("key is always lowercase", () => {
    const paper = makePaper({
      authors: [{ name: "UPPER CASE" }],
      title: "CAPS Title",
      published: "2020-01-01T00:00:00Z",
    });
    const bib = generateBibTeX(paper);
    const keyLine = bib.split("\n")[0];
    // key portion between { and ,
    const key = keyLine.replace("@misc{", "").replace(",", "");
    expect(key).toBe(key.toLowerCase());
  });
});
