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

/**
 * Strip common Markdown syntax to produce readable plain text.
 * - ATX headings: `## X` → `X`
 * - Bold/italic/strikethrough: `**x**`, `*x*`, `_x_`, `~~x~~` → `x`
 * - Inline code/backticks: `` `x` `` → `x`
 * - Links: `[text](url)` → `text`
 * - Images: `![alt](url)` → `alt`
 * - Blockquotes: strips `> ` prefixes
 * - List markers: `- `, `* `, `1. ` → item text kept
 * - Math `$…$`/`$$…$$` and table pipes left as-is (simple and deterministic)
 * - Excess blank lines collapsed to at most one blank line
 */
export function markdownToText(md: string): string {
  let text = md;

  // ATX headings: strip leading `#` chars and optional trailing `#`
  text = text.replace(/^#{1,6}\s+(.+?)(?:\s+#+)?$/gm, "$1");

  // Images: ![alt](url) → alt  (must come before links)
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");

  // Links: [text](url) → text
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");

  // Strikethrough: ~~x~~ → x
  text = text.replace(/~~(.+?)~~/g, "$1");

  // Bold+italic: ***x*** or ___x___ → x  (handle longest first)
  text = text.replace(/\*{3}(.+?)\*{3}/g, "$1");
  text = text.replace(/_{3}(.+?)_{3}/g, "$1");

  // Bold: **x** or __x__ → x
  text = text.replace(/\*{2}(.+?)\*{2}/g, "$1");
  text = text.replace(/_{2}(.+?)_{2}/g, "$1");

  // Italic: *x* or _x_ → x  (single char boundary avoids touching math $x$)
  // Use negated character class instead of .+? to avoid O(N²) backtracking on
  // lines with many lone markers.
  text = text.replace(/(?<!\*)\*(?!\*)([^*\n]+?)\*(?!\*)/g, "$1");
  text = text.replace(/(?<!_)_(?!_)([^_\n]+?)_(?!_)/g, "$1");

  // Inline code: `x` → x  (but NOT $$…$$ or $…$ — leave math alone)
  text = text.replace(/`([^`]+)`/g, "$1");

  // Blockquotes: strip leading `> ` on each line
  text = text.replace(/^>\s?/gm, "");

  // List markers: unordered `- ` / `* ` and ordered `1. ` etc.
  text = text.replace(/^(\s*)[-*]\s+/gm, "$1");
  text = text.replace(/^(\s*)\d+\.\s+/gm, "$1");

  // Collapse 3+ consecutive blank lines to a single blank line
  text = text.replace(/\n{3,}/g, "\n\n");

  return text.trim();
}
