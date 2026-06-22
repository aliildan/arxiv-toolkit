import { parseHTML } from "linkedom";
import type { Section } from "../types.js";
import { htmlFragmentToMarkdown, makeTurndown } from "./html-common.js";

interface Ar5ivDoc {
  title: string;
  abstract?: string;
  sections: Section[];
}

function sectionContent(
  el: Element,
  td: ReturnType<typeof makeTurndown>,
): string {
  const clone = el.cloneNode(true) as Element;
  // Strip the section's own heading (bare or ltx_*) — only the first heading.
  const heading = clone.querySelector("h1, h2, h3, h6");
  heading?.remove();
  clone
    .querySelectorAll("section.ltx_subsection, section.ltx_subsubsection")
    .forEach((s) => s.remove());
  return htmlFragmentToMarkdown(clone.innerHTML, td);
}

export function parseAr5ivHtml(html: string): Ar5ivDoc {
  const { document } = parseHTML(html);
  const td = makeTurndown();

  // ar5iv-distinct title first, then the LaTeXML form as a defensive fallback.
  const title =
    document
      .querySelector("h1.title.mathjax, h1.ltx_title_document")
      ?.textContent?.trim() ?? "";

  let abstract: string | undefined;
  const absEl = document.querySelector("div.abstract, section.ltx_abstract");
  if (absEl) {
    const clone = absEl.cloneNode(true) as Element;
    clone.querySelector("h6.ltx_title_abstract, .abstract-title, h6")?.remove();
    const md = htmlFragmentToMarkdown(clone.innerHTML, td);
    abstract = md.length > 0 ? md : undefined;
  }

  const sections: Section[] = [];
  const topSections = document.querySelectorAll("section.ltx_section");
  for (const sec of Array.from(topSections)) {
    const heading = sec.querySelector("h2, h1");
    sections.push({
      id: sec.getAttribute("id") ?? undefined,
      title: heading?.textContent?.trim() ?? "",
      level: 1,
      content: sectionContent(sec, td),
    });
    for (const sub of Array.from(sec.querySelectorAll("section.ltx_subsection"))) {
      const subHeading = sub.querySelector("h3, h2");
      sections.push({
        id: sub.getAttribute("id") ?? undefined,
        title: subHeading?.textContent?.trim() ?? "",
        level: 2,
        content: sectionContent(sub, td),
      });
    }
  }

  return { title, abstract, sections };
}
