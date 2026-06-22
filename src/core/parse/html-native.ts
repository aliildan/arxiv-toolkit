import { parseHTML } from "linkedom";
import type { Section } from "../types.js";
import { htmlFragmentToMarkdown, makeTurndown } from "./html-common.js";

interface NativeDoc {
  title: string;
  abstract?: string;
  sections: Section[];
}

/**
 * Convert a section element to Markdown after removing its own heading and any
 * nested deeper-level <section> blocks (those are flattened separately).
 */
function sectionContent(
  el: Element,
  td: ReturnType<typeof makeTurndown>,
): string {
  const clone = el.cloneNode(true) as Element;
  // Drop the heading (title is captured separately).
  clone
    .querySelectorAll(
      "h1.ltx_title_section, h2.ltx_title_section, h3.ltx_title_subsection, h2.ltx_title_bibliography",
    )
    .forEach((h) => h.remove());
  // Drop nested sections/subsections so their text isn't duplicated here.
  clone
    .querySelectorAll("section.ltx_subsection, section.ltx_subsubsection")
    .forEach((s) => s.remove());
  return htmlFragmentToMarkdown(clone.innerHTML, td);
}

export function parseNativeHtml(html: string): NativeDoc {
  const { document } = parseHTML(html);
  const td = makeTurndown();

  const title =
    document
      .querySelector("h1.ltx_title_document")
      ?.textContent?.trim() ?? "";

  let abstract: string | undefined;
  const absEl = document.querySelector("section.ltx_abstract");
  if (absEl) {
    const clone = absEl.cloneNode(true) as Element;
    clone.querySelector("h6.ltx_title_abstract")?.remove();
    const md = htmlFragmentToMarkdown(clone.innerHTML, td);
    abstract = md.length > 0 ? md : undefined;
  }

  const sections: Section[] = [];
  const topSections = document.querySelectorAll("section.ltx_section");
  for (const sec of Array.from(topSections)) {
    const id = sec.getAttribute("id") ?? undefined;
    const heading =
      sec.querySelector("h2.ltx_title_section, h2.ltx_title_bibliography") ??
      sec.querySelector("h1.ltx_title_section");
    const sTitle = heading?.textContent?.trim() ?? "";
    sections.push({
      id,
      title: sTitle,
      level: 1,
      content: sectionContent(sec, td),
    });
    // Flatten this section's direct subsections, in document order.
    const subs = sec.querySelectorAll("section.ltx_subsection");
    for (const sub of Array.from(subs)) {
      const subId = sub.getAttribute("id") ?? undefined;
      const subHeading = sub.querySelector("h3.ltx_title_subsection");
      sections.push({
        id: subId,
        title: subHeading?.textContent?.trim() ?? "",
        level: 2,
        content: sectionContent(sub, td),
      });
    }
  }

  return { title, abstract, sections };
}
