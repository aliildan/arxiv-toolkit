<!-- Phase: Read full text -->

### Task A: Shared HTML→Markdown converter (src/core/parse/html-common.ts)

**Files:**
- Source: `/Users/aildan/arxiv/src/core/parse/html-common.ts` (Create)
- Test: `/Users/aildan/arxiv/test/core/parse/html-common.test.ts` (Create)
- Commit: `src/core/parse/html-common.ts`, `test/core/parse/html-common.test.ts`

**Interfaces:**
- Consumes: `turndown` (`import TurndownService from "turndown"`); `turndown-plugin-gfm` (CJS — `import gfmPkg from "turndown-plugin-gfm"; const { gfm } = gfmPkg;`).
- Produces:
  - `export function makeTurndown(): TurndownService`
  - `export function htmlFragmentToMarkdown(html: string, td?: TurndownService): string`

**Notes for the implementer:** This module is the **single** HTML→Markdown converter shared by both schema branches (native `ltx_*` and ar5iv). It never selects elements by schema — it receives an HTML **fragment** (the inner HTML of one section) and returns Markdown. Schema-specific selection lives in `html-native.ts` / `html-ar5iv.ts` (Tasks B/C).

Configuration of the `TurndownService`:
- GFM tables/strikethrough via the plugin: `td.use(gfm)`. The plugin is **CJS**; the default import is the namespace and `gfm` is a property of it (`const { gfm } = gfmPkg`). Importing it wrong is the regression the §15 smoke test guards.
- **Math survives as LaTeX.** LaTeXML/MathJax emit a `<math>` MathML element that carries the original TeX in an `<annotation encoding="application/x-tex">` child (inside `<semantics>`). Add a Turndown rule keyed on `math` that, given the node, reads that annotation's text and emits `$…$` for inline math (`<math display="inline">` or no `display`) and `$$…$$` for `<math display="block">`. If no TeX annotation is present, fall back to the element's text content. Returning the delimited TeX means the surrounding `<semantics>`/`<annotation>` subtree is consumed by this rule (Turndown does not descend into a node a rule fully replaces), so raw MathML never leaks.
- **Footnotes / superscripts.** Keep `<sup>` content inline (Turndown's default would drop the tag's semantics); add a rule that renders `<sup>` as its inner Markdown wrapped so the marker survives (e.g. `^{…}` is noisy — emit the inner text in square brackets only when it is a footnote/cite link, otherwise keep the plain superscript text). Concretely: a `sup` whose only child is an `<a>` is a footnote/citation marker → emit `[<text>]`; a bare `sup` (e.g. `x²` exponents already unicode, or `10<sup>3</sup>`) → emit `^<text>`.
- **Bibliography.** `section.ltx_bibliography` is handled at selection time (Task B keeps it as a normal section); within `html-common` no special rule is needed beyond the `<sup>`/cite handling, but ensure `<cite>` is unwrapped to its text (`addRule` keyed on `cite` returning the inner Markdown) so reference markers read cleanly.

`htmlFragmentToMarkdown(html, td?)` builds a Turndown service once if `td` is omitted (callers that convert many sections should construct one via `makeTurndown()` and pass it in to avoid rebuilding). It returns `td.turndown(html).trim()`.

- [ ] **Step 1: Write the failing converter test (incl. the §15 gfm ESM smoke test).** Create `test/core/parse/html-common.test.ts`. Complete file:

```ts
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
```

- [ ] **Step 2: Run the test, expect FAIL.** Run: `npx vitest run test/core/parse/html-common.test.ts`. Expected: FAIL — `Cannot find module '../../../src/core/parse/html-common.js'`.

- [ ] **Step 3: Implement src/core/parse/html-common.ts.** Create the file. Complete contents:

```ts
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
```

- [ ] **Step 4: Run the test, expect PASS.** Run: `npx vitest run test/core/parse/html-common.test.ts`. Expected: PASS — gfm smoke test green; table, inline/display math, math-text fallback, footnote/cite markers all green. If the `<sup>`/`<cite>` rules interact with Turndown's `children` access under your DOM (Turndown runs on its own DOM via jsdom-free string parsing internally), prefer `el.childNodes`/`el.textContent`, which Turndown's node objects expose; do not switch the surrounding selection to a different DOM — `html-common` only ever sees Turndown's node objects.

- [ ] **Step 5: Run typecheck.** Run: `npx tsc --noEmit`. Expected: no errors originating in `src/core/parse/html-common.ts` or its test. (Other not-yet-created files are out of scope for this task.)

- [ ] **Step 6: Commit.** Run:
```
git add src/core/parse/html-common.ts test/core/parse/html-common.test.ts && git commit -m "feat(core): add shared HTML→Markdown converter with math/footnote/table rules

- makeTurndown() configures turndown + turndown-plugin-gfm (CJS-interop via
  default import then destructure { gfm }); §15 ESM smoke test guards the regression.
- math rule emits original TeX as \$…\$ / \$\$…\$\$ from the x-tex annotation,
  consuming the MathML subtree; sup rule keeps footnote/citation + exponent markers;
  cite unwrapped to text.
- htmlFragmentToMarkdown converts one section's inner HTML; accepts a shared service.
"
```

---

### Task B: Parse native LaTeXML HTML (src/core/parse/html-native.ts)

**Files:**
- Source: `/Users/aildan/arxiv/src/core/parse/html-native.ts` (Create)
- Fixture: `/Users/aildan/arxiv/test/fixtures/native.html` (Create)
- Test: `/Users/aildan/arxiv/test/core/parse/html-native.test.ts` (Create)
- Commit: `src/core/parse/html-native.ts`, `test/fixtures/native.html`, `test/core/parse/html-native.test.ts`

**Interfaces:**
- Consumes: `linkedom` (`import { parseHTML } from "linkedom"`); `Section` from `src/core/types.ts`; `htmlFragmentToMarkdown`, `makeTurndown` from `./html-common.js`.
- Produces: `export function parseNativeHtml(html: string): { title: string; abstract?: string; sections: Section[] }`

**Notes for the implementer:** Native HTML is the LaTeXML `ltx_*` schema (spec §5.2):
- Title: `h1.ltx_title_document` (text).
- Abstract: `section.ltx_abstract`; its heading is `h6.ltx_title_abstract` (strip that heading, convert the remaining body to Markdown for the `abstract` string).
- Sections: every `section.ltx_section` — `id` from the element's `id` attribute (`S1`), title from `h2.ltx_title_section`, `level: 1`. Subsections: `section.ltx_subsection` — `id` (`S1.SS1`), title `h3.ltx_title_subsection`, `level: 2`.
- Flatten the document into an **ordered** `Section[]` by walking sections then their subsections in document order. Each `Section.content` is the **inner HTML of that block with the heading element and any nested deeper-level `<section>` removed**, converted via `html-common`. (Removing nested subsections from a parent section's content prevents duplicating subsection text — subsections appear as their own flattened entries.)
- Build one `TurndownService` via `makeTurndown()` and pass it to every `htmlFragmentToMarkdown` call.
- The bibliography is `section#bib.ltx_bibliography`; treat it as a normal section (it usually has `ltx_section`-like structure or its own heading — select its heading via `h2.ltx_title_section, h2.ltx_title_bibliography` defensively).
- **Empty/zero-section result is the fallback signal:** if there are zero `section.ltx_section` blocks (e.g. an unexpected page), return `{ title, abstract, sections: [] }` and let the caller (Task E) fall through to ar5iv/PDF. Do not throw on empty.

- [ ] **Step 1: Write the native HTML fixture.** Create `test/fixtures/native.html`. Complete file:

```html
<!DOCTYPE html>
<html lang="en">
  <head><title>Sample Native</title></head>
  <body>
    <article class="ltx_document">
      <h1 class="ltx_title ltx_title_document">A Native LaTeXML Paper</h1>
      <div class="ltx_authors"><span class="ltx_personname">Ada Lovelace</span></div>
      <section class="ltx_abstract">
        <h6 class="ltx_title ltx_title_abstract">Abstract</h6>
        <p class="ltx_p">We study a thing and show <math display="inline"><semantics><mrow><mi>x</mi></mrow><annotation encoding="application/x-tex">x &gt; 0</annotation></semantics></math>.</p>
      </section>
      <section id="S1" class="ltx_section">
        <h2 class="ltx_title ltx_title_section">Introduction</h2>
        <p class="ltx_p">The mass-energy relation <math display="inline"><semantics><mrow><mi>E</mi><mo>=</mo><mi>m</mi><msup><mi>c</mi><mn>2</mn></msup></mrow><annotation encoding="application/x-tex">E = mc^2</annotation></semantics></math> holds.<sup id="fnref1"><a href="#fn1">1</a></sup></p>
        <section id="S1.SS1" class="ltx_subsection">
          <h3 class="ltx_title ltx_title_subsection">Background</h3>
          <p class="ltx_p">Prior work in <cite>Smith 2019</cite> is relevant.</p>
        </section>
      </section>
      <section id="S2" class="ltx_section">
        <h2 class="ltx_title ltx_title_section">Methods</h2>
        <table class="ltx_tabular">
          <thead><tr><th>Param</th><th>Value</th></tr></thead>
          <tbody><tr><td>lr</td><td>0.01</td></tr></tbody>
        </table>
      </section>
    </article>
  </body>
</html>
```

- [ ] **Step 2: Write the failing native-parse test.** Create `test/core/parse/html-native.test.ts`. Complete file:

```ts
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
```

- [ ] **Step 3: Run the test, expect FAIL.** Run: `npx vitest run test/core/parse/html-native.test.ts`. Expected: FAIL — `Cannot find module '../../../src/core/parse/html-native.js'`.

- [ ] **Step 4: Implement src/core/parse/html-native.ts.** Create the file. Complete contents:

```ts
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
```

- [ ] **Step 5: Run the test, expect PASS.** Run: `npx vitest run test/core/parse/html-native.test.ts`. Expected: PASS — title, abstract (heading stripped, math kept), flattened section/subsection ids+titles+levels in order, no subsection-text duplication, footnote/cite, and GFM table all green.

- [ ] **Step 6: Run typecheck.** Run: `npx tsc --noEmit`. Expected: no errors originating in this task's files.

- [ ] **Step 7: Commit.** Run:
```
git add src/core/parse/html-native.ts test/fixtures/native.html test/core/parse/html-native.test.ts && git commit -m "feat(core): parse native LaTeXML (ltx_*) HTML into ordered sections

- title h1.ltx_title_document; abstract section.ltx_abstract (heading stripped);
  sections section.ltx_section (h2, id S1); subsections section.ltx_subsection (h3, id S1.SS1).
- flatten to ordered Section[]; per-section content removes its heading + nested
  subsections (no duplication) and is converted via html-common (shared turndown).
- zero sections => empty result (caller's fallback signal), never throws.
- fixture exercises math, footnote, cite, and a GFM table.
"
```

---

### Task C: Parse ar5iv HTML (src/core/parse/html-ar5iv.ts)

**Files:**
- Source: `/Users/aildan/arxiv/src/core/parse/html-ar5iv.ts` (Create)
- Fixture: `/Users/aildan/arxiv/test/fixtures/ar5iv.html` (Create)
- Test: `/Users/aildan/arxiv/test/core/parse/html-ar5iv.test.ts` (Create)
- Commit: `src/core/parse/html-ar5iv.ts`, `test/fixtures/ar5iv.html`, `test/core/parse/html-ar5iv.test.ts`

**Interfaces:**
- Consumes: `linkedom` (`parseHTML`); `Section` from `src/core/types.ts`; `htmlFragmentToMarkdown`, `makeTurndown` from `./html-common.js`.
- Produces: `export function parseAr5ivHtml(html: string): { title: string; abstract?: string; sections: Section[] }`

**Notes for the implementer:** **A single selector set cannot parse both schemas.** ar5iv is the older Labs schema (spec §5.2): the title is `h1.title.mathjax` (class list `title mathjax`), and section headings are **bare `h1`/`h2`** rather than `h2.ltx_title_section`. Because ar5iv still descends from a LaTeXML lineage it often *also* carries `ltx_*` markup, but the contract pins the ar5iv-distinct selectors — match on `h1.ltx_title_document, h1.title.mathjax` for the title (try ar5iv-specific first), and segment sections by the older structure. This file is a **separate branch** from `html-native.ts`; both feed the shared `html-common.ts` converter (do not try to unify them).

Section segmentation for ar5iv:
- Title: `h1.title.mathjax` (fallback `h1.ltx_title_document`).
- Abstract: `div.abstract, section.ltx_abstract` (heading may be `h6.ltx_title_abstract` or a `<div class="abstract-title">`/leading `Abstract` run — strip a leading heading element if present).
- Sections: prefer `section.ltx_section` if present (ar5iv frequently keeps them); otherwise fall back to splitting on bare `h2` headings within the body. Use `id` attribute when present. Subsections: `section.ltx_subsection` or bare `h3`. Keep `level` 1 for sections, 2 for subsections. Reuse the same "clone, strip heading + nested subsections, convert" approach as Task B.
- Zero sections → empty result (fallback signal), never throw.

- [ ] **Step 1: Write the ar5iv fixture (older schema).** Create `test/fixtures/ar5iv.html`. Complete file:

```html
<!DOCTYPE html>
<html lang="en">
  <head><title>Sample ar5iv</title></head>
  <body>
    <div class="ltx_page_content">
      <h1 class="ltx_title title mathjax">An ar5iv Historical Paper</h1>
      <div class="abstract">
        <h6 class="abstract-title">Abstract</h6>
        <p>We revisit a classic result and recover <math display="inline"><semantics><mrow><mi>a</mi></mrow><annotation encoding="application/x-tex">a \le b</annotation></semantics></math>.</p>
      </div>
      <section id="S1" class="ltx_section">
        <h2 class="ltx_title">Overview</h2>
        <p>A bare-schema overview with a marker.<sup><a href="#bib1">2</a></sup></p>
        <section id="S1.SS1" class="ltx_subsection">
          <h3 class="ltx_title">Details</h3>
          <p>Details cite <cite>Jones 2001</cite>.</p>
        </section>
      </section>
      <section id="S2" class="ltx_section">
        <h2 class="ltx_title">Results</h2>
        <p>The result is positive.</p>
      </section>
    </div>
  </body>
</html>
```

- [ ] **Step 2: Write the failing ar5iv-parse test.** Create `test/core/parse/html-ar5iv.test.ts`. Complete file:

```ts
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
```

- [ ] **Step 3: Run the test, expect FAIL.** Run: `npx vitest run test/core/parse/html-ar5iv.test.ts`. Expected: FAIL — `Cannot find module '../../../src/core/parse/html-ar5iv.js'`.

- [ ] **Step 4: Implement src/core/parse/html-ar5iv.ts.** Create the file. Complete contents:

```ts
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
```

- [ ] **Step 5: Run the test, expect PASS.** Run: `npx vitest run test/core/parse/html-ar5iv.test.ts`. Expected: PASS.

- [ ] **Step 6: Run typecheck.** Run: `npx tsc --noEmit`. Expected: no errors in this task's files.

- [ ] **Step 7: Commit.** Run:
```
git add src/core/parse/html-ar5iv.ts test/fixtures/ar5iv.html test/core/parse/html-ar5iv.test.ts && git commit -m "feat(core): parse ar5iv (older bare-h1/h2) HTML into ordered sections

- title h1.title.mathjax (ltx_title_document fallback); abstract div.abstract;
  separate branch from html-native — a single selector set cannot parse both schemas.
- shared html-common converter; flatten sections/subsections in order; strip own
  heading + nested subsections per block; zero sections => empty (fallback signal).
"
```

---

### Task D: PDF text extraction (src/core/parse/pdf.ts)

**Files:**
- Source: `/Users/aildan/arxiv/src/core/parse/pdf.ts` (Create)
- Fixture: `/Users/aildan/arxiv/test/fixtures/sample.pdf` (Create, via a setup step)
- Test: `/Users/aildan/arxiv/test/core/parse/pdf.test.ts` (Create)
- Commit: `src/core/parse/pdf.ts`, `test/fixtures/sample.pdf`, `test/fixtures/make-sample-pdf.ts`, `test/core/parse/pdf.test.ts`

**Interfaces:**
- Consumes: `unpdf` (`import { extractText, getDocumentProxy } from "unpdf"`); `Section` from `src/core/types.ts`.
- Produces: `export async function parsePdf(bytes: Uint8Array): Promise<{ title?: string; sections: Section[]; warning: string }>`

**Notes for the implementer:** `unpdf` bundles a worker-free PDF.js. `extractText` accepts a `Uint8Array` (or a PDFDocumentProxy). The v1 behavior (spec §7.2) is deliberately minimal: extract all text, clean it up, and return it as a **single best-effort section** with a fixed `warning`. No heading heuristics.

Cleanup steps on the raw extracted text:
- **De-hyphenate** line-break hyphenation: replace `-\n` (a hyphen at end of line) joining word fragments with the empty string (`foo-\nbar` → `foobar`). Be conservative: only join when a lowercase letter precedes the hyphen and a lowercase letter follows the newline.
- **Collapse whitespace:** turn runs of spaces/newlines into single spaces, then trim. (v1 does not preserve paragraph structure.)

The single returned section: `{ title: "Full text", level: 1, content: <cleaned text> }` (no `id`). `title` at the top level is left `undefined` in v1 (no reliable title heuristic from raw PDF text). `warning` is exactly `"PDF text extraction: single-section, no heading heuristics"`.

The fixture is a tiny valid PDF carrying a **known sentence** so the test is deterministic and offline. Generate it in a committed setup script (so the bytes are reproducible) and commit both the script and the resulting `sample.pdf`.

- [ ] **Step 1: Write the fixture generator and produce sample.pdf.** Create `test/fixtures/make-sample-pdf.ts` — a minimal hand-written PDF emitter (no external deps; the file embeds a single text line). Complete file:

```ts
// Generates test/fixtures/sample.pdf: a minimal one-page PDF whose content
// stream draws a single known sentence. Run with: npx tsx test/fixtures/make-sample-pdf.ts
// Committed alongside the produced sample.pdf so the bytes are reproducible.
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SENTENCE = "The quick brown fox studies super-symmetry.";

function buildPdf(text: string): Uint8Array {
  const objects: string[] = [];
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push("<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  objects.push(
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] " +
      "/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
  );
  const stream = `BT /F1 24 Tf 72 700 Td (${text}) Tj ET`;
  objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (const off of offsets) {
    pdf += `${off.toString().padStart(10, "0")} 00000 n \n`;
  }
  pdf +=
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n` +
    `startxref\n${xrefStart}\n%%EOF`;
  return new Uint8Array(Buffer.from(pdf, "latin1"));
}

const here = dirname(fileURLToPath(import.meta.url));
writeFileSync(join(here, "sample.pdf"), buildPdf(SENTENCE));
// eslint-disable-next-line no-console
console.log("wrote sample.pdf");
```

Run it to produce the committed fixture: `npx tsx test/fixtures/make-sample-pdf.ts`. Confirm `test/fixtures/sample.pdf` exists and starts with `%PDF-1.4`. (If `tsx` is unavailable, run via `node --import tsx test/fixtures/make-sample-pdf.ts`.) Sanity-check that `unpdf` can read it before writing the parser test: `node -e "import('unpdf').then(async u=>{const b=require('fs').readFileSync('test/fixtures/sample.pdf');console.log((await u.extractText(new Uint8Array(b),{mergePages:true})).text)})"` should print the known sentence. If `unpdf` cannot extract from this hand-written PDF on your platform, replace the generator body with a `pdf-lib` (devDependency) emitter that draws the same `SENTENCE` — the test assertions below are unchanged.

- [ ] **Step 2: Write the failing PDF-parse test.** Create `test/core/parse/pdf.test.ts`. Complete file:

```ts
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
```

- [ ] **Step 3: Run the test, expect FAIL.** Run: `npx vitest run test/core/parse/pdf.test.ts`. Expected: FAIL — `Cannot find module '../../../src/core/parse/pdf.js'`.

- [ ] **Step 4: Implement src/core/parse/pdf.ts.** Create the file. Complete contents:

```ts
import { extractText, getDocumentProxy } from "unpdf";
import type { Section } from "../types.js";

const WARNING = "PDF text extraction: single-section, no heading heuristics";

/**
 * Clean raw extracted PDF text: join conservative line-break hyphenation
 * (lowercase-hyphen-newline-lowercase), then collapse all whitespace runs to a
 * single space and trim. v1 does not preserve paragraph structure.
 */
export function cleanupText(raw: string): string {
  const dehyphenated = raw.replace(/([a-z])-\n([a-z])/g, "$1$2");
  return dehyphenated.replace(/\s+/g, " ").trim();
}

export async function parsePdf(
  bytes: Uint8Array,
): Promise<{ title?: string; sections: Section[]; warning: string }> {
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: true });
  const content = cleanupText(typeof text === "string" ? text : text.join(" "));
  const sections: Section[] = [{ title: "Full text", level: 1, content }];
  return { title: undefined, sections, warning: WARNING };
}
```

- [ ] **Step 5: Run the test, expect PASS.** Run: `npx vitest run test/core/parse/pdf.test.ts`. Expected: PASS — single section titled "Full text", known sentence present, fixed warning; cleanup helper de-hyphenates conservatively and collapses whitespace.

- [ ] **Step 6: Run typecheck.** Run: `npx tsc --noEmit`. Expected: no errors in this task's files.

- [ ] **Step 7: Commit.** Run:
```
git add src/core/parse/pdf.ts test/fixtures/sample.pdf test/fixtures/make-sample-pdf.ts test/core/parse/pdf.test.ts && git commit -m "feat(core): extract PDF text via unpdf into a single best-effort section

- parsePdf uses unpdf extractText (worker-free PDF.js); cleanupText de-hyphenates
  line-break hyphenation conservatively and collapses whitespace.
- v1 returns one 'Full text' section + fixed warning (no heading heuristics).
- committed tiny hand-written sample.pdf (+ reproducible generator) for an
  offline, deterministic assertion.
"
```

---

### Task E: client.getContent + client.download (replace the Phase-4 stubs)

**Files:**
- Modify: `/Users/aildan/arxiv/src/core/client.ts` (replace the two Phase-6 stub bodies; add imports)
- Test: `/Users/aildan/arxiv/test/core/client-content.test.ts` (Create)
- Commit: `src/core/client.ts`, `test/core/client-content.test.ts`

**Interfaces:**
- Consumes (already imported by Phase 4 or added here): `normalizeId`, `htmlUrl`, `ar5ivUrl`, `pdfUrl`, `absUrl`, `filenameFor` from `./ids.js`; `parseNativeHtml` from `./parse/html-native.js`; `parseAr5ivHtml` from `./parse/html-ar5iv.js`; `parsePdf` from `./parse/pdf.js`; `NotFoundError`, `UnsupportedError`, `ParseError`, `NetworkError` from `./errors.js`; `Section`, `PaperContent`, `ReadOptions`, `DownloadOptions` from `./types.js`; `DataSource` (the `api`/`browser` fields). `node:fs/promises` (`mkdir`, `writeFile`) and `node:path` (`join`).
- Produces: the filled bodies of `ArxivClient.getContent(id, opts?)` and `ArxivClient.download(id, opts?)`.

**Notes for the implementer — source matrix & fallback (spec §7.2, contracts §6):**
- **`source: 'auto'` (default):** native HTML → ar5iv → PDF.
- **`source: 'html'`:** native → ar5iv only; if **both** fail → `UnsupportedError` (never PDF).
- **`source: 'pdf'`:** PDF only (skip HTML).
- **Fallback triggers:** `5xx`/`429` are retried inside `Http` (Phase 3); a step falls through only after retries exhaust. **native→ar5iv on HTTP 404** — `api.getHtml` returns `null` on 404 (contracts §3), that is the trigger. **ar5iv→PDF on {404 (`null`), network error (`NetworkError` thrown), or a 200 that parses to zero sections}.**
- **abs page** is fetched **only** in the two §7.2 cases. In Phase 6's read path the relevant case is: a **caller-pinned `v{n}` 404s** — fetch `absUrl` to discover the max version, re-pin, and retry the same source step once. Unversioned reads never fetch abs. (The other abs case, toBibTeX, is Phase 7.)

**Content caching (contracts §6, spec §8):** the **full** extracted content (all sections) is cached once per `{kind:"content", id, version, source}` tuple via `this.cache?` (guarded — `undefined` when `noCache`). `format`/`section`/`maxChars`/cursor views are computed **in-memory** from the cached full content; chunks are not separately keyed. TTL: versioned → `Infinity`; unversioned/latest → 24h (`24*60*60*1000`).

**Chunking & cursor (the central mechanism):**
- Build the **full** `Section[]` (from whichever parser won) plus resolved `{id, version, source, title, abstract}`. This is the cache value.
- **`section` option wins** over `maxChars`: case-insensitive match **first on `Section.id`**, then **substring on `Section.title`**. Zero matches → `NotFoundError` whose message lists the available section titles. Multiple matches → take the **first by document order** and push a `warning` naming the others. Return that one section as the chunk (`truncated: false`, no `nextCursor`).
- Otherwise **`maxChars`** is a soft target. Starting at `sectionIndex` (0, or the cursor's), accumulate **whole** sections while the running char count stays within `maxChars`; always include at least one section (a single section larger than `maxChars` is returned whole). If `maxChars` is undefined, return **all** remaining sections in one chunk.
- **Cursor** = base64 of `JSON.stringify({ id, version, source, sectionIndex, charOffset: 0 })`. Decode validates the caller-supplied `id` matches the cursor's `id` → else `ParseError`. The decoded `source`/`version` pin the read (a newer published version is ignored mid-read; re-resolve to the same cached tuple, a transparent cache miss if evicted).
- **`nextCursor`** present **iff** more sections remain after this chunk (`endIndex < sections.length`); it encodes `sectionIndex = endIndex`. **`truncated`** is `true` **iff** the read was chunked at all — i.e. a cursor was supplied OR a `nextCursor` is produced OR a single `section` was selected from a multi-section doc. (Practically: `truncated = !!opts.cursor || !!nextCursor || (sectionSelected && sections.length > 1)`.)
- **`format`:** `'markdown'` (default) returns the section content as-is (already Markdown from html-common; PDF text is plain but stored in `content`). `'text'` is a best-effort strip — for v1, when `format: 'text'`, return the same `content` (Markdown is already close to plain for our fixtures); set `PaperContent.format` accordingly. `text` field of `PaperContent` = the chunk's section contents joined by `"\n\n"`.

**`download` (contracts §6):** `n = normalizeId(id)`; `dir = opts?.dir ?? cfg.downloadsDir`; `bytes = await api.getPdf(pdfUrl(n))`; `await mkdir(dir, {recursive:true})`; `path = join(dir, filenameFor(n))`; `await writeFile(path, bytes)`; return `{ path, bytes: bytes.byteLength }`. Print nothing (the CLI prints the path). Uses the same `api` DataSource and `ids.ts` builders.

- [ ] **Step 1: Write the failing content/cursor/download test (fake DataSource injection).** Create `test/core/client-content.test.ts`. The test injects a fake `DataSource` by constructing the client and replacing its private `api` field (cast through `unknown`); each fake returns fixtures or throws chosen errors. Complete file:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ArxivClient } from "../../src/core/client.js";
import type { DataSource } from "../../src/core/datasource/datasource.js";
import { NotFoundError } from "../../src/core/errors.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): string =>
  readFileSync(join(here, "..", "fixtures", name), "utf8");
const pdfBytes = (): Uint8Array =>
  new Uint8Array(readFileSync(join(here, "..", "fixtures", "sample.pdf")));

const NATIVE = fixture("native.html");
const AR5IV = fixture("ar5iv.html");

/** Build a client with caching disabled and a fake DataSource injected. */
function clientWith(fake: Partial<DataSource>): ArxivClient {
  const client = new ArxivClient({ noCache: true });
  const ds: DataSource = {
    query: async () => {
      throw new Error("query not used");
    },
    getHtml: async () => null,
    getPdf: async () => pdfBytes(),
    getText: async () => {
      throw new Error("getText not used");
    },
    ...fake,
  };
  // Inject over the private `api` field for the test.
  (client as unknown as { api: DataSource }).api = ds;
  return client;
}

describe("getContent source matrix", () => {
  it("auto: returns native HTML content when native is available", async () => {
    const client = clientWith({
      getHtml: async (url) => (url.includes("/html/") ? NATIVE : null),
    });
    const res = await client.getContent("2310.06825");
    expect(res.source).toBe("html-native");
    expect(res.title).toBe("A Native LaTeXML Paper");
    expect(res.sections.map((s) => s.id)).toEqual(["S1", "S1.SS1", "S2"]);
  });

  it("auto: falls through native(404) -> ar5iv", async () => {
    const client = clientWith({
      getHtml: async (url) =>
        url.includes("ar5iv") ? AR5IV : null, // native 404 -> null
    });
    const res = await client.getContent("cond-mat/0011267");
    expect(res.source).toBe("html-ar5iv");
    expect(res.title).toBe("An ar5iv Historical Paper");
  });

  it("auto: falls through native(404) -> ar5iv(404) -> PDF", async () => {
    const client = clientWith({ getHtml: async () => null });
    const res = await client.getContent("hep-th/9901001");
    expect(res.source).toBe("pdf");
    expect(res.sections).toHaveLength(1);
    expect(res.sections[0].content).toContain("super-symmetry");
    expect(res.warnings).toContain(
      "PDF text extraction: single-section, no heading heuristics",
    );
  });

  it("auto: ar5iv 200-with-zero-sections triggers PDF fallback", async () => {
    const client = clientWith({
      getHtml: async (url) =>
        url.includes("ar5iv") ? "<html><body><p>no sections</p></body></html>" : null,
    });
    const res = await client.getContent("hep-th/9901002");
    expect(res.source).toBe("pdf");
  });

  it("html: native(404)+ar5iv(404) -> UnsupportedError (never PDF)", async () => {
    let pdfCalled = false;
    const client = clientWith({
      getHtml: async () => null,
      getPdf: async () => {
        pdfCalled = true;
        return pdfBytes();
      },
    });
    await expect(
      client.getContent("hep-th/9901003", { source: "html" }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED" });
    expect(pdfCalled).toBe(false);
  });

  it("pdf: skips HTML entirely", async () => {
    let htmlCalled = false;
    const client = clientWith({
      getHtml: async () => {
        htmlCalled = true;
        return NATIVE;
      },
    });
    const res = await client.getContent("2310.06825", { source: "pdf" });
    expect(res.source).toBe("pdf");
    expect(htmlCalled).toBe(false);
  });
});

describe("getContent section selection", () => {
  it("selects by id (case-insensitive), wins over maxChars", async () => {
    const client = clientWith({
      getHtml: async (url) => (url.includes("/html/") ? NATIVE : null),
    });
    const res = await client.getContent("2310.06825", {
      section: "s1.ss1",
      maxChars: 1,
    });
    expect(res.sections).toHaveLength(1);
    expect(res.sections[0].id).toBe("S1.SS1");
    expect(res.truncated).toBe(true);
    expect(res.nextCursor).toBeUndefined();
  });

  it("selects by title substring when id does not match", async () => {
    const client = clientWith({
      getHtml: async (url) => (url.includes("/html/") ? NATIVE : null),
    });
    const res = await client.getContent("2310.06825", { section: "methods" });
    expect(res.sections[0].id).toBe("S2");
    expect(res.sections[0].title).toBe("Methods");
  });

  it("zero matches -> NotFoundError listing titles", async () => {
    const client = clientWith({
      getHtml: async (url) => (url.includes("/html/") ? NATIVE : null),
    });
    await expect(
      client.getContent("2310.06825", { section: "nope" }),
    ).rejects.toThrow(/Introduction|Methods/);
  });
});

describe("getContent cursor round-trip", () => {
  it("walks nextCursor to completion with whole-section chunks", async () => {
    const client = clientWith({
      getHtml: async (url) => (url.includes("/html/") ? NATIVE : null),
    });
    const collected: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const res = await client.getContent("2310.06825", {
        maxChars: 1, // tiny target => one whole section per chunk
        cursor,
      });
      // each chunk holds at least one whole section, never a fragment
      expect(res.sections.length).toBeGreaterThanOrEqual(1);
      for (const s of res.sections) collected.push(s.id ?? s.title);
      // truncated true whenever the read is chunked
      expect(res.truncated).toBe(true);
      cursor = res.nextCursor;
      pages++;
      expect(pages).toBeLessThan(10); // guard against infinite loop
    } while (cursor);
    expect(collected).toEqual(["S1", "S1.SS1", "S2"]);
  });

  it("rejects a cursor presented with a different id -> ParseError", async () => {
    const client = clientWith({
      getHtml: async (url) => (url.includes("/html/") ? NATIVE : null),
    });
    const first = await client.getContent("2310.06825", { maxChars: 1 });
    expect(first.nextCursor).toBeDefined();
    await expect(
      client.getContent("2401.00001", { cursor: first.nextCursor }),
    ).rejects.toMatchObject({ code: "PARSE" });
  });

  it("the last chunk has no nextCursor", async () => {
    const client = clientWith({
      getHtml: async (url) => (url.includes("/html/") ? NATIVE : null),
    });
    // big maxChars => single chunk, all sections, no nextCursor, not truncated
    const res = await client.getContent("2310.06825", { maxChars: 100000 });
    expect(res.sections.map((s) => s.id)).toEqual(["S1", "S1.SS1", "S2"]);
    expect(res.nextCursor).toBeUndefined();
    expect(res.truncated).toBe(false);
  });
});

describe("download", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "arxiv-dl-"));
  });

  it("writes the PDF to dir/filenameFor(id) and returns path+bytes", async () => {
    const bytes = pdfBytes();
    const client = clientWith({ getPdf: async () => bytes });
    const out = await client.download("cond-mat/0011267v1", { dir });
    expect(out.path).toBe(join(dir, "cond-mat_0011267v1.pdf"));
    expect(out.bytes).toBe(bytes.byteLength);
    const written = await readFile(out.path);
    expect(new Uint8Array(written)).toEqual(bytes);
    await rm(dir, { recursive: true, force: true });
  });

  it("propagates NotFoundError from getPdf", async () => {
    const client = clientWith({
      getPdf: async () => {
        throw new NotFoundError("nope");
      },
    });
    await expect(client.download("0000.00000", { dir })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await rm(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run the test, expect FAIL.** Run: `npx vitest run test/core/client-content.test.ts`. Expected: FAIL — `getContent`/`download` still throw the Phase-4 stub errors (`getContent: implemented in Phase 6` / `download: implemented in Phase 6`), so every assertion fails.

- [ ] **Step 3: Add the Phase-6 imports to client.ts.** The Phase-4 import block (contracts §4) does not yet import the parsers, the extra id builders, `node:fs`/`node:path`, or the content errors. Insert these imports after the existing `import { ApiDataSource } from "./datasource/api.js";` line in `src/core/client.ts`:

```ts
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  normalizeId,
  htmlUrl,
  ar5ivUrl,
  pdfUrl,
  absUrl,
  filenameFor,
} from "./ids.js";
import { parseNativeHtml } from "./parse/html-native.js";
import { parseAr5ivHtml } from "./parse/html-ar5iv.js";
import { parsePdf } from "./parse/pdf.js";
import {
  NotFoundError,
  UnsupportedError,
  ParseError,
  NetworkError,
} from "./errors.js";
import type { Section, NormalizedId } from "./types.js";
```

(If Phase 4 already imports `normalizeId`/`absUrl`/`pdfUrl`/`filenameFor`/`NotFoundError`/`NetworkError` for `search`/`getPaper`, drop the duplicate names from the block above — keep only the not-yet-imported ones: `htmlUrl`, `ar5ivUrl`, the three parsers, `UnsupportedError`, `ParseError`, `Section`, `NormalizedId`, `mkdir`, `writeFile`, `join`. The repo must compile with no duplicate-import errors.)

- [ ] **Step 4: Add the private content helpers to the class.** Insert these private methods inside the `ArxivClient` class body (e.g. just above the `// Phase 6:` marker). Complete code:

```ts
  // ---- Phase 6 helpers (content extraction, fallback, cursor) ----

  private contentTtl(n: NormalizedId): number {
    return n.version !== undefined ? Infinity : 24 * 60 * 60 * 1000;
  }

  /** Full extracted content for one resolved source (the cache value shape). */
  private async extractContent(
    n: NormalizedId,
    source: "auto" | "html" | "pdf",
  ): Promise<{
    source: "html-native" | "html-ar5iv" | "pdf";
    title: string;
    abstract?: string;
    sections: Section[];
    warnings: string[];
  }> {
    const warnings: string[] = [];

    const tryNative = async () => {
      const html = await this.api.getHtml(htmlUrl(n)); // null on 404
      if (html === null) return null;
      const parsed = parseNativeHtml(html);
      if (parsed.sections.length === 0) return null; // unexpected page => fall through
      return {
        source: "html-native" as const,
        title: parsed.title,
        abstract: parsed.abstract,
        sections: parsed.sections,
      };
    };

    const tryAr5iv = async () => {
      let html: string | null;
      try {
        html = await this.api.getHtml(ar5ivUrl(n)); // null on 404
      } catch (err) {
        if (err instanceof NetworkError) return null; // network => fall through to PDF
        throw err;
      }
      if (html === null) return null;
      const parsed = parseAr5ivHtml(html);
      if (parsed.sections.length === 0) return null; // 200-with-zero-sections => fall through
      warnings.push("ar5iv fallback used");
      return {
        source: "html-ar5iv" as const,
        title: parsed.title,
        abstract: parsed.abstract,
        sections: parsed.sections,
      };
    };

    const tryPdf = async () => {
      const bytes = await this.api.getPdf(pdfUrl(n)); // throws NotFoundError on 404
      const parsed = await parsePdf(bytes);
      warnings.push(parsed.warning);
      return {
        source: "pdf" as const,
        title: parsed.title ?? "",
        abstract: undefined,
        sections: parsed.sections,
      };
    };

    if (source === "pdf") {
      const pdf = await tryPdf();
      return { ...pdf, warnings };
    }

    const native = await tryNative();
    if (native) return { ...native, warnings };

    const ar5iv = await tryAr5iv();
    if (ar5iv) return { ...ar5iv, warnings };

    if (source === "html") {
      throw new UnsupportedError(
        `No HTML rendering available for ${n.idWithVersion ?? n.id} (native and ar5iv both unavailable); try --source pdf`,
      );
    }

    // source === "auto": universal PDF fallback.
    const pdf = await tryPdf();
    return { ...pdf, warnings };
  }
```

- [ ] **Step 5: Replace the `getContent` stub body.** In `src/core/client.ts`, find the exact Phase-4 stub line:

```ts
  async getContent(id: string, opts?: ReadOptions): Promise<PaperContent> { throw new Error("getContent: implemented in Phase 6"); }
```

and replace that one line with the full method:

```ts
  async getContent(id: string, opts?: ReadOptions): Promise<PaperContent> {
    const n = normalizeId(id);
    const source = opts?.source ?? "auto";
    const format = opts?.format ?? "markdown";

    // A cursor pins {id, version, source, sectionIndex}; validate id match first.
    let startIndex = 0;
    if (opts?.cursor) {
      const decoded = decodeCursor(opts.cursor);
      if (decoded.id !== n.id) {
        throw new ParseError(
          `Cursor id mismatch: cursor is for ${decoded.id}, requested ${n.id}`,
        );
      }
      startIndex = decoded.sectionIndex;
    }

    // Resolve the full content for {id, version, source}, with caching.
    const cacheKey = (resolved: string) => ({
      kind: "content" as const,
      id: n.id,
      version: n.version,
      source: resolved,
    });

    let full:
      | {
          source: "html-native" | "html-ar5iv" | "pdf";
          title: string;
          abstract?: string;
          sections: Section[];
          warnings: string[];
        }
      | undefined;

    // When a cursor pins a source we can hit the cache directly for that tuple.
    if (opts?.cursor) {
      const decoded = decodeCursor(opts.cursor);
      const cached = await this.cache?.get<typeof full>(
        cacheKey(decoded.source),
      );
      if (cached) full = cached;
    }

    if (!full) {
      full = await this.extractContent(n, source);
      await this.cache?.set(
        cacheKey(full.source),
        full,
        this.contentTtl(n),
      );
    }

    const warnings = [...full.warnings];
    const allSections = full.sections;

    // ---- section selection wins over maxChars ----
    if (opts?.section) {
      const needle = opts.section.toLowerCase();
      let matches = allSections.filter(
        (s) => (s.id ?? "").toLowerCase() === needle,
      );
      if (matches.length === 0) {
        matches = allSections.filter((s) =>
          s.title.toLowerCase().includes(needle),
        );
      }
      if (matches.length === 0) {
        const titles = allSections.map((s) => s.title).join(", ");
        throw new NotFoundError(
          `No section matching "${opts.section}". Available: ${titles}`,
        );
      }
      if (matches.length > 1) {
        const others = matches
          .slice(1)
          .map((s) => s.title)
          .join(", ");
        warnings.push(
          `Multiple sections matched "${opts.section}"; returning the first. Others: ${others}`,
        );
      }
      const chosen = matches[0];
      return this.assemble(n, full, [chosen], {
        format,
        truncated: allSections.length > 1,
        nextCursor: undefined,
        warnings,
      });
    }

    // ---- maxChars soft target: accumulate whole sections ----
    const maxChars = opts?.maxChars;
    let endIndex = startIndex;
    let acc = 0;
    while (endIndex < allSections.length) {
      const len = allSections[endIndex].content.length;
      if (
        maxChars !== undefined &&
        endIndex > startIndex &&
        acc + len > maxChars
      ) {
        break; // adding this section would exceed the target; stop (keep ≥1)
      }
      acc += len;
      endIndex++;
      if (maxChars === undefined) {
        // no target => take everything in one chunk
        endIndex = allSections.length;
        break;
      }
    }

    const chunk = allSections.slice(startIndex, endIndex);
    const hasMore = endIndex < allSections.length;
    const nextCursor = hasMore
      ? encodeCursor({
          id: n.id,
          version: n.version,
          source: full.source,
          sectionIndex: endIndex,
          charOffset: 0,
        })
      : undefined;
    const truncated = !!opts?.cursor || hasMore;

    return this.assemble(n, full, chunk, {
      format,
      truncated,
      nextCursor,
      warnings,
    });
  }

  /** Build a PaperContent response from a chunk of sections. */
  private assemble(
    n: NormalizedId,
    full: {
      source: "html-native" | "html-ar5iv" | "pdf";
      title: string;
      abstract?: string;
    },
    chunk: Section[],
    opts: {
      format: "markdown" | "text";
      truncated: boolean;
      nextCursor?: string;
      warnings: string[];
    },
  ): PaperContent {
    return {
      id: n.id,
      version: n.version,
      source: full.source,
      format: opts.format,
      title: full.title,
      abstract: full.abstract,
      sections: chunk,
      text: chunk.map((s) => s.content).join("\n\n"),
      truncated: opts.truncated,
      nextCursor: opts.nextCursor,
      warnings: opts.warnings.length > 0 ? opts.warnings : undefined,
    };
  }
```

- [ ] **Step 6: Replace the `download` stub body.** In `src/core/client.ts`, find the exact Phase-4 stub line:

```ts
  async download(id: string, opts?: DownloadOptions): Promise<{ path: string; bytes: number }> { throw new Error("download: implemented in Phase 6"); }
```

and replace that one line with the full method:

```ts
  async download(
    id: string,
    opts?: DownloadOptions,
  ): Promise<{ path: string; bytes: number }> {
    const n = normalizeId(id);
    const dir = opts?.dir ?? this.cfg.downloadsDir;
    const bytes = await this.api.getPdf(pdfUrl(n));
    await mkdir(dir, { recursive: true });
    const path = join(dir, filenameFor(n));
    await writeFile(path, bytes);
    return { path, bytes: bytes.byteLength };
  }
```

- [ ] **Step 7: Add the cursor codec at module scope (bottom of client.ts).** Append these helpers below the `ArxivClient` class in `src/core/client.ts`:

```ts
interface CursorPayload {
  id: string;
  version?: number;
  source: "html-native" | "html-ar5iv" | "pdf";
  sectionIndex: number;
  charOffset: number;
}

function encodeCursor(p: CursorPayload): string {
  return Buffer.from(JSON.stringify(p), "utf8").toString("base64");
}

function decodeCursor(cursor: string): CursorPayload {
  try {
    const json = Buffer.from(cursor, "base64").toString("utf8");
    const p = JSON.parse(json) as CursorPayload;
    if (
      typeof p.id !== "string" ||
      typeof p.sectionIndex !== "number" ||
      (p.source !== "html-native" &&
        p.source !== "html-ar5iv" &&
        p.source !== "pdf")
    ) {
      throw new ParseError("Malformed cursor payload");
    }
    return p;
  } catch (err) {
    if (err instanceof ParseError) throw err;
    throw new ParseError(`Invalid cursor: ${String(err)}`);
  }
}
```

- [ ] **Step 8: Run the content test, expect PASS.** Run: `npx vitest run test/core/client-content.test.ts`. Expected: PASS — full source matrix (native; native→ar5iv; native→ar5iv→PDF; ar5iv-zero-sections→PDF; `html` both-fail→UnsupportedError and never calls getPdf; `pdf` skips HTML), section selection (id, title, zero→NotFoundError), the cursor round-trip (whole-section chunks, `["S1","S1.SS1","S2"]`, last chunk has no `nextCursor`, `truncated` invariants), id-mismatch→ParseError, and download (writes `cond-mat_0011267v1.pdf`, returns path+bytes; propagates NotFoundError).

- [ ] **Step 9: Run the full Phase-6 suite + typecheck.** Run: `npx vitest run test/core/parse test/core/client-content.test.ts`. Expected: PASS (Tasks A–E). Run: `npx tsc --noEmit`. Expected: PASS (no errors originating in `client.ts` or the parse modules). If `tsc` flags the test's private-field injection cast, confirm it is the `(client as unknown as { api: DataSource }).api = ds;` line and that it compiles (the double-cast through `unknown` is intentional and type-checks).

- [ ] **Step 10: Commit.** Run:
```
git add src/core/client.ts test/core/client-content.test.ts && git commit -m "feat(core): implement getContent (source matrix + cursor) and download

- getContent: auto = native→ar5iv→PDF; html = native→ar5iv only (both fail =>
  UnsupportedError, never PDF); pdf = PDF only. Fallback triggers per §7.2
  (native→ar5iv on 404; ar5iv→PDF on 404/network/200-zero-sections; 5xx/429
  retried in Http first). Full content cached per {kind,id,version,source}.
- chunking: section wins over maxChars (id then title substring; zero =>
  NotFoundError listing titles; multiple => first + warning); maxChars is a soft
  target accumulating whole sections; cursor = base64 {id,version,source,
  sectionIndex,charOffset:0}; decode validates id => else ParseError; nextCursor
  iff more remains; truncated iff chunked.
- download: getPdf(pdfUrl) -> mkdir -> write filenameFor into opts.dir ?? cfg.downloadsDir.
- replaces the Phase-4 getContent/download stubs; fake DataSource drives the full matrix.
"
```
