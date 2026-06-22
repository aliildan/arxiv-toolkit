<!-- Phase: Metadata + BibTeX -->

### Task A — BibTeX generator (src/core/bibtex.ts)

**Files:**
- Test: `/Users/aildan/arxiv/test/core/bibtex.test.ts` (Create)
- Source: `/Users/aildan/arxiv/src/core/bibtex.ts` (Create)
- Commit: `src/core/bibtex.ts`, `test/core/bibtex.test.ts`

**Interfaces:**
- Consumes: `Paper`, `Author` from `src/core/types.ts`
- Produces:
  - `export function generateBibTeX(paper: Paper): string`

**Notes for the implementer:** `generateBibTeX` must produce exactly the `@misc` template from spec §7.3:
- Key: `<firstAuthorLast><year><firstTitleWord>` — all lowercase. `firstAuthorLast` = last whitespace-token of `authors[0].name`. `year` = 4-digit year extracted from `paper.published` (first four characters, e.g. `"2023-10-10T..."` → `"2023"`). `firstTitleWord` = first token in `paper.title` that contains at least one alphabetic character (`/[a-zA-Z]/`), then stripped of all non-alphanumeric characters and lowercased.
- `eprint`: bare `paper.id` verbatim — the slash in old-style IDs is kept as-is (e.g. `cond-mat/0011267`).
- `archivePrefix`: always the literal string `arXiv`.
- `primaryClass`: `paper.primaryCategory`.
- `url`: `https://arxiv.org/abs/<paper.id>`.
- `author`: `paper.authors.map(a => a.name).join(" and ")`.
- `doi={…}`: emitted only when `paper.doi` is defined and non-empty; placed immediately after `url`.
- Field indentation: eight spaces before each field name; field separator: `,\n` (comma then newline). Last field also carries a trailing comma before the closing `}`.
- The output format is:
  ```
  @misc{<key>,\n        title={<title>},\n        author={<authors>},\n        year={<year>},\n        eprint={<id>},\n        archivePrefix={arXiv},\n        primaryClass={<primaryCategory>},\n        url={https://arxiv.org/abs/<id>},\n}
  ```
  When `doi` is present it appears between `url` and the closing brace:
  ```
        doi={<doi>},\n
  ```

- [ ] **Step 1: Write the failing test file.** Create `test/core/bibtex.test.ts`. Complete file:

```ts
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
```

- [ ] **Step 2: Run the test, expect FAIL.** Run: `npx vitest run test/core/bibtex.test.ts`. Expected: FAIL — `Cannot find module '../../src/core/bibtex.js'`.

- [ ] **Step 3: Implement src/core/bibtex.ts.** Create the file. Complete contents:

```ts
import type { Paper } from "./types.js";

/**
 * Derive the BibTeX cite key from a Paper.
 * Key = <firstAuthorLast><year><firstTitleWord>, all lowercase.
 * - firstAuthorLast: last whitespace-separated token of authors[0].name
 * - year: first 4 characters of paper.published
 * - firstTitleWord: first whitespace token in title that contains at least one
 *   alphabetic character, with all non-alphanumeric characters stripped, lowercased.
 */
function buildKey(paper: Paper): string {
  const firstAuthorName = paper.authors[0]?.name ?? "unknown";
  const tokens = firstAuthorName.trim().split(/\s+/);
  const firstAuthorLast = (tokens[tokens.length - 1] ?? "unknown").toLowerCase();

  const year = paper.published.slice(0, 4);

  const titleTokens = paper.title.trim().split(/\s+/);
  let firstTitleWord = "untitled";
  for (const tok of titleTokens) {
    if (/[a-zA-Z]/.test(tok)) {
      firstTitleWord = tok.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
      break;
    }
  }

  return `${firstAuthorLast}${year}${firstTitleWord}`;
}

/**
 * Generate an offline @misc BibTeX entry for the given Paper.
 * Follows the template from spec §7.3 exactly.
 * The `doi` field is emitted only when `paper.doi` is defined and non-empty.
 */
export function generateBibTeX(paper: Paper): string {
  const key = buildKey(paper);
  const year = paper.published.slice(0, 4);
  const authorStr = paper.authors.map((a) => a.name).join(" and ");
  const url = `https://arxiv.org/abs/${paper.id}`;

  const indent = "        ";

  let out = `@misc{${key},\n`;
  out += `${indent}title={${paper.title}},\n`;
  out += `${indent}author={${authorStr}},\n`;
  out += `${indent}year={${year}},\n`;
  out += `${indent}eprint={${paper.id}},\n`;
  out += `${indent}archivePrefix={arXiv},\n`;
  out += `${indent}primaryClass={${paper.primaryCategory}},\n`;
  out += `${indent}url={${url}},\n`;
  if (paper.doi && paper.doi.length > 0) {
    out += `${indent}doi={${paper.doi}},\n`;
  }
  out += `}`;

  return out;
}
```

- [ ] **Step 4: Run the test, expect PASS.** Run: `npx vitest run test/core/bibtex.test.ts`. Expected: PASS — all fixture assertions green, including key derivation, old-style slash, doi presence/absence, author joining, and lowercase key.

- [ ] **Step 5: Run typecheck.** Run: `npx tsc --noEmit`. Expected: no type errors originating in `src/core/bibtex.ts` or `test/core/bibtex.test.ts`.

- [ ] **Step 6: Commit.**

```
git add src/core/bibtex.ts test/core/bibtex.test.ts && git commit -m "feat(core): add generateBibTeX offline @misc generator

- generateBibTeX(paper) produces the exact §7.3 @misc template: title, author
  (and-joined), year (4-digit from published), eprint (bare id, slash kept for
  old-style), archivePrefix=arXiv, primaryClass, url; doi only when present.
- Key = <firstAuthorLast><year><firstTitleWord>, all lowercase.
- Tests cover new/old-style ids, doi present/absent, key derivation, and-join,
  non-alphabetic title-prefix skipping, and key lowercase invariant.
"
```

---

### Task B — client.ts: implement toBibTeX (replace Phase 4 stub)

**Files:**
- Test: `/Users/aildan/arxiv/test/core/client-bibtex.test.ts` (Create)
- Source: `/Users/aildan/arxiv/src/core/client.ts` (Modify — replace the one-line stub body)
- Commit: `src/core/client.ts`, `test/core/client-bibtex.test.ts`

**Interfaces:**
- Consumes:
  - `bibtexUrl`, `normalizeId` from `src/core/ids.js`
  - `generateBibTeX` from `src/core/bibtex.js`
  - `DataSource` (`getText(url): Promise<string>`) injected via `this.api`
  - `this.getPaper(id)` (fully implemented in Phase 4)
- Produces:
  - `toBibTeX(id: string): Promise<string>` on `ArxivClient`

**Notes for the implementer:** The Phase 4 stub body is the exact string:
```
throw new Error("toBibTeX: implemented in Phase 7");
```
Replace **only that method body** using an Edit-style targeted replacement. The logic is:

1. Normalize `id` to a `NormalizedId` via `normalizeId(id)`.
2. Construct the canonical URL via `bibtexUrl(n)`.
3. Call `await this.api.getText(bibtexUrl(n))` and return the result verbatim.
4. If `this.api.getText` throws for any reason, fall back: call `await this.getPaper(id)`, pass the returned `Paper` to `generateBibTeX(paper)`, and return that string.

No caching of the BibTeX text is performed (keeping it simple and consistent with contracts §6 which does not mention a BibTeX cache key). `getPaper` already benefits from the metadata cache, so the fallback path is naturally efficient.

The `generateBibTeX` import must be added to `client.ts`. The `bibtexUrl` import is already present from Phase 4 (Phase 4 creates `ids.ts` and `client.ts` imports it for `getPaper`/`getPapers`). If `bibtexUrl` is not yet imported in `client.ts`, add it to the existing import from `"./ids.js"`.

**Test strategy:** Inject a fake `DataSource` that satisfies the interface. Use `vi.spyOn` or a hand-rolled fake object. `getPaper` is the live method from `ArxivClient` and would hit the network — instead, subclass or monkey-patch `getPaper` on the instance under test to return a fixture `Paper` without touching the network.

- [ ] **Step 1: Write the failing test file.** Create `test/core/client-bibtex.test.ts`. Complete file:

```ts
import { describe, it, expect, vi } from "vitest";
import { ArxivClient } from "../../src/core/client.js";
import type { DataSource } from "../../src/core/datasource/datasource.js";
import type { Paper } from "../../src/core/types.js";
import { generateBibTeX } from "../../src/core/bibtex.js";

// A Paper fixture used both as getPaper's return value and as a source of truth
// for the generated fallback string.
const FIXTURE_PAPER: Paper = {
  id: "2310.06825",
  title: "Attention Is All You Need",
  summary: "We propose a new network architecture, the Transformer.",
  authors: [{ name: "Ashish Vaswani" }, { name: "Noam Shazeer" }],
  categories: ["cs.CL", "cs.AI"],
  primaryCategory: "cs.CL",
  published: "2017-06-12T00:00:00Z",
  updated: "2017-06-12T00:00:00Z",
  links: {
    abs: "https://arxiv.org/abs/2310.06825",
    pdf: "https://arxiv.org/pdf/2310.06825",
  },
};

const CANONICAL_BIBTEX = `@misc{vaswani2017attention_canonical,
  author = {Ashish Vaswani and Noam Shazeer},
  title  = {Attention Is All You Need},
  year   = {2017},
  url    = {https://arxiv.org/abs/2310.06825}
}`;

/**
 * Build a minimal DataSource whose getText resolves or rejects as needed.
 * All other methods throw — they should never be called by toBibTeX.
 */
function makeDataSource(
  getTextImpl: (url: string) => Promise<string>
): DataSource {
  return {
    query: () => Promise.reject(new Error("query: not expected")),
    getHtml: () => Promise.reject(new Error("getHtml: not expected")),
    getPdf: () => Promise.reject(new Error("getPdf: not expected")),
    getText: getTextImpl,
  };
}

/**
 * Construct an ArxivClient whose `this.api` is replaced by our fake DataSource.
 * We also stub `getPaper` on the instance so it returns FIXTURE_PAPER without
 * hitting the network.
 */
function makeClient(ds: DataSource): ArxivClient {
  // Pass noCache so Cache is not constructed (avoids needing a real cacheDir).
  const client = new ArxivClient({ noCache: true });
  // Replace the internal api field — it is private but accessible via bracket notation in JS.
  (client as unknown as Record<string, unknown>)["api"] = ds;
  // Stub getPaper to return the fixture without a network call.
  vi.spyOn(client, "getPaper").mockResolvedValue(FIXTURE_PAPER);
  return client;
}

describe("ArxivClient.toBibTeX", () => {
  it("returns the canonical string verbatim when getText succeeds", async () => {
    const ds = makeDataSource(() => Promise.resolve(CANONICAL_BIBTEX));
    const client = makeClient(ds);
    const result = await client.toBibTeX("2310.06825");
    expect(result).toBe(CANONICAL_BIBTEX);
  });

  it("calls getText with the correct bibtex endpoint URL", async () => {
    const getTextSpy = vi.fn().mockResolvedValue(CANONICAL_BIBTEX);
    const ds = makeDataSource(getTextSpy);
    const client = makeClient(ds);
    await client.toBibTeX("2310.06825");
    expect(getTextSpy).toHaveBeenCalledWith(
      "https://arxiv.org/bibtex/2310.06825"
    );
  });

  it("falls back to generateBibTeX when getText throws", async () => {
    const ds = makeDataSource(() =>
      Promise.reject(new Error("network failure"))
    );
    const client = makeClient(ds);
    const result = await client.toBibTeX("2310.06825");
    const expected = generateBibTeX(FIXTURE_PAPER);
    expect(result).toBe(expected);
  });

  it("invokes getPaper with the original id string during fallback", async () => {
    const ds = makeDataSource(() =>
      Promise.reject(new Error("not found"))
    );
    const client = makeClient(ds);
    await client.toBibTeX("2310.06825");
    expect(client.getPaper).toHaveBeenCalledWith("2310.06825");
  });

  it("calls getText with old-style slash preserved in the URL", async () => {
    const getTextSpy = vi.fn().mockResolvedValue(CANONICAL_BIBTEX);
    const ds = makeDataSource(getTextSpy);
    const client = makeClient(ds);
    await client.toBibTeX("cond-mat/0011267");
    expect(getTextSpy).toHaveBeenCalledWith(
      "https://arxiv.org/bibtex/cond-mat/0011267"
    );
  });
});
```

- [ ] **Step 2: Run the test, expect FAIL.** Run: `npx vitest run test/core/client-bibtex.test.ts`. Expected: FAIL — `toBibTeX: implemented in Phase 7` error thrown, confirming the stub is in place and the test correctly exercises it.

- [ ] **Step 3: Replace the toBibTeX stub body in src/core/client.ts.**

First, add the `generateBibTeX` import. Locate the existing imports at the top of `src/core/client.ts`. Add this import (after the existing local imports):

```ts
import { generateBibTeX } from "./bibtex.js";
```

If `bibtexUrl` is not already imported from `"./ids.js"`, add it to that import line. The Phase 4 file imports at minimum `normalizeId`, `absUrl`, `pdfUrl`, `filenameFor` from `"./ids.js"` — add `bibtexUrl` to that list.

Then, replace the stub method body. The exact text to find in `src/core/client.ts`:

```ts
  async toBibTeX(id: string): Promise<string> { throw new Error("toBibTeX: implemented in Phase 7"); }
```

Replace it with:

```ts
  async toBibTeX(id: string): Promise<string> {
    const n = normalizeId(id);
    try {
      return await this.api.getText(bibtexUrl(n));
    } catch {
      const paper = await this.getPaper(id);
      return generateBibTeX(paper);
    }
  }
```

- [ ] **Step 4: Run the test, expect PASS.** Run: `npx vitest run test/core/client-bibtex.test.ts`. Expected: PASS — canonical path returns verbatim string, getText is called with the correct URL (slash preserved for old-style), fallback path invokes `getPaper` and returns `generateBibTeX(paper)`.

- [ ] **Step 5: Run all existing tests together and typecheck.** Run: `npx vitest run`. Expected: all previously passing tests still PASS (no regressions). Run: `npx tsc --noEmit`. Expected: no type errors.

- [ ] **Step 6: Commit.**

```
git add src/core/client.ts test/core/client-bibtex.test.ts && git commit -m "feat(core): implement ArxivClient.toBibTeX with canonical fetch and offline fallback

- Fetches https://arxiv.org/bibtex/{id} via DataSource.getText and returns
  the response verbatim (canonical arXiv BibTeX).
- On any getText failure, falls back to getPaper(id) + generateBibTeX(paper).
- Old-style ids keep the slash in the bibtex URL (bibtexUrl from ids.ts).
- Tests cover canonical path, correct URL construction (incl. old-style slash),
  fallback invocation, and getPaper call-through on failure.
"
```
