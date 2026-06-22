import TurndownService from "turndown";
import gfmPkg from "turndown-plugin-gfm";

// turndown-plugin-gfm ships as CommonJS: the default import is the namespace
// object and `gfm` is a property of it. Destructuring here is the correct
// ESM interop and is asserted by the §15 smoke test.
const { gfm } = gfmPkg;

/** Read the LaTeX source a LaTeXML/MathJax <math> node carries, if any. */
function texAnnotation(node: HTMLElement): string | null {
  const ann = node.querySelector?.('annotation[encoding="application/x-tex"]');
  const tex = ann?.textContent?.trim();
  return tex && tex.length > 0 ? tex : null;
}

/**
 * Build a TurndownService configured for arXiv HTML fragments:
 * GFM tables/strikethrough, math preserved as `$…$`/`$$…$$`, footnote/cite
 * markers kept readable. Construct once and reuse across many sections.
 */
export function makeTurndown(): TurndownService {
  const td = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
    emDelimiter: "*",
  });

  td.use(gfm);

  // Math: emit the original TeX, inline vs. display by the `display` attribute.
  // Returning a string consumes the whole <math> subtree (incl. <semantics>/
  // <annotation>), so raw MathML never leaks into the Markdown.
  td.addRule("math", {
    filter: (node) => node.nodeName.toLowerCase() === "math",
    replacement: (_content, node) => {
      const el = node as unknown as HTMLElement;
      const tex = texAnnotation(el) ?? el.textContent?.trim() ?? "";
      if (tex.length === 0) return "";
      const display = el.getAttribute?.("display");
      return display === "block" ? `$$${tex}$$` : `$${tex}$`;
    },
  });

  // Superscripts: a sup whose sole child is an <a> is a footnote/citation
  // marker -> `[text]`; any other sup -> `^text`.
  td.addRule("sup", {
    filter: (node) => node.nodeName.toLowerCase() === "sup",
    replacement: (content, node) => {
      const el = node as unknown as HTMLElement;
      const text = (el.textContent ?? content).trim();
      if (text.length === 0) return "";
      const onlyChild =
        el.children?.length === 1 &&
        el.children[0].nodeName.toLowerCase() === "a";
      return onlyChild ? `[${text}]` : `^${text}`;
    },
  });

  // <cite> -> its inner text (reference markers read cleanly).
  td.addRule("cite", {
    filter: (node) => node.nodeName.toLowerCase() === "cite",
    replacement: (content) => content,
  });

  return td;
}

/**
 * Convert an HTML fragment (the inner HTML of one section) to Markdown.
 * Pass a shared `td` from makeTurndown() when converting many fragments.
 */
export function htmlFragmentToMarkdown(
  html: string,
  td?: TurndownService,
): string {
  const service = td ?? makeTurndown();
  return service.turndown(html).trim();
}
