<!-- Phase: Search core -->

### Task A: Atom feed parser (src/core/parse/atom.ts)

**Files:**
- Test: `/Users/aildan/arxiv/test/core/parse/atom.test.ts` (Create)
- Fixtures: `/Users/aildan/arxiv/test/fixtures/atom-single.xml`, `/Users/aildan/arxiv/test/fixtures/atom-multi.xml` (Create)
- Source: `/Users/aildan/arxiv/src/core/parse/atom.ts` (Create)
- Commit: `src/core/parse/atom.ts`, `test/core/parse/atom.test.ts`, `test/fixtures/atom-single.xml`, `test/fixtures/atom-multi.xml`

**Interfaces:**
- Consumes: `Paper`, `Author`, `SearchResult` from `../types.js` (via `../../src/core/types.js` in tests); `normalizeId` from `../ids.js`; `ParseError` from `../errors.js`; `fast-xml-parser` (`XMLParser`).
- Produces: `export function parseFeed(xml: string): SearchResult` — maps OpenSearch `totalResults`/`startIndex`/`itemsPerPage` → `total`/`start`/`count`, and each Atom `entry` → `Paper`. Entry `id` (an abs URL incl. version) is reduced to the bare id via `normalizeId`, yielding `id`/`version`/`idWithVersion`. `title`/`summary` are trimmed; `author` → `{ name, affiliation? }`; `category[@term]` → `categories[]`; `primary_category[@term]` → `primaryCategory`; `published`/`updated` carried verbatim; optional `doi`/`journal_ref`/`comment`; `links` from the `link` array (`abs` = the `rel=alternate` `text/html` link or the entry id; `pdf` = the `title=pdf` link; `html` set only if a `rel=related type=text/html` link other than the abs is present).

**Notes for the implementer:** Use `fast-xml-parser` configured with `removeNSPrefix: true` (so `opensearch:totalResults`/`arxiv:primary_category` become `totalResults`/`primary_category`), `ignoreAttributes: false` (so `@_term`/`@_rel`/`@_href`/`@_title` survive), and the **predicate** `isArray: (name) => ["entry","author","category","link"].includes(name)` (NOT a blanket `() => true` — that over-applies and breaks the structure). A single-entry feed must still yield `entry` as a one-element array; the fixtures lock that. `feed.entry` may be absent on a zero-result feed → treat as `[]`. Attribute access uses the default `@_` prefix.

- [ ] **Step 1: Write the two Atom fixtures.** Create `test/fixtures/atom-single.xml` (one entry, namespaced fields, affiliation present, doi + journal_ref + comment present):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"
      xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/"
      xmlns:arxiv="http://arxiv.org/schemas/atom">
  <link href="http://export.arxiv.org/api/query?search_query%3Dall:mistral" rel="self" type="application/atom+xml"/>
  <title type="html">ArXiv Query: search_query=all:mistral</title>
  <id>http://export.arxiv.org/api/abc</id>
  <updated>2023-10-10T00:00:00-04:00</updated>
  <opensearch:totalResults xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">1</opensearch:totalResults>
  <opensearch:startIndex xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">0</opensearch:startIndex>
  <opensearch:itemsPerPage xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">1</opensearch:itemsPerPage>
  <entry>
    <id>http://arxiv.org/abs/2310.06825v1</id>
    <updated>2023-10-10T17:54:09Z</updated>
    <published>2023-10-10T17:54:09Z</published>
    <title>Mistral 7B</title>
    <summary>  We introduce Mistral 7B, a 7-billion-parameter language model. </summary>
    <author>
      <name>Albert Q. Jiang</name>
      <arxiv:affiliation xmlns:arxiv="http://arxiv.org/schemas/atom">Mistral AI</arxiv:affiliation>
    </author>
    <author>
      <name>Alexandre Sablayrolles</name>
    </author>
    <arxiv:doi xmlns:arxiv="http://arxiv.org/schemas/atom">10.1000/xyz123</arxiv:doi>
    <link title="doi" href="http://dx.doi.org/10.1000/xyz123" rel="related"/>
    <arxiv:comment xmlns:arxiv="http://arxiv.org/schemas/atom">Models and code available</arxiv:comment>
    <arxiv:journal_ref xmlns:arxiv="http://arxiv.org/schemas/atom">Proc. of FooConf 2023</arxiv:journal_ref>
    <link href="http://arxiv.org/abs/2310.06825v1" rel="alternate" type="text/html"/>
    <link title="pdf" href="http://arxiv.org/pdf/2310.06825v1" rel="related" type="application/pdf"/>
    <arxiv:primary_category xmlns:arxiv="http://arxiv.org/schemas/atom" term="cs.CL" scheme="http://arxiv.org/schemas/atom"/>
    <category term="cs.CL" scheme="http://arxiv.org/schemas/atom"/>
    <category term="cs.AI" scheme="http://arxiv.org/schemas/atom"/>
    <category term="cs.LG" scheme="http://arxiv.org/schemas/atom"/>
  </entry>
</feed>
```

Create `test/fixtures/atom-multi.xml` (two entries; the second has no affiliation, no doi/journal_ref/comment, a single category, and an old-style id — locking the `isArray` shape and `normalizeId` reuse):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"
      xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/"
      xmlns:arxiv="http://arxiv.org/schemas/atom">
  <title type="html">ArXiv Query: search_query=cat:cs.CL</title>
  <id>http://export.arxiv.org/api/def</id>
  <updated>2023-10-10T00:00:00-04:00</updated>
  <opensearch:totalResults xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">42</opensearch:totalResults>
  <opensearch:startIndex xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">0</opensearch:startIndex>
  <opensearch:itemsPerPage xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">2</opensearch:itemsPerPage>
  <entry>
    <id>http://arxiv.org/abs/2310.06825v1</id>
    <updated>2023-10-10T17:54:09Z</updated>
    <published>2023-10-10T17:54:09Z</published>
    <title>Mistral 7B</title>
    <summary>We introduce Mistral 7B.</summary>
    <author>
      <name>Albert Q. Jiang</name>
    </author>
    <link href="http://arxiv.org/abs/2310.06825v1" rel="alternate" type="text/html"/>
    <link title="pdf" href="http://arxiv.org/pdf/2310.06825v1" rel="related" type="application/pdf"/>
    <arxiv:primary_category xmlns:arxiv="http://arxiv.org/schemas/atom" term="cs.CL" scheme="http://arxiv.org/schemas/atom"/>
    <category term="cs.CL" scheme="http://arxiv.org/schemas/atom"/>
    <category term="cs.AI" scheme="http://arxiv.org/schemas/atom"/>
  </entry>
  <entry>
    <id>http://arxiv.org/abs/cond-mat/0011267v2</id>
    <updated>2000-11-15T18:00:00Z</updated>
    <published>2000-11-15T18:00:00Z</published>
    <title>An Old-Style Paper</title>
    <summary>A historical condensed-matter abstract.</summary>
    <author>
      <name>Jane Doe</name>
    </author>
    <link href="http://arxiv.org/abs/cond-mat/0011267v2" rel="alternate" type="text/html"/>
    <link title="pdf" href="http://arxiv.org/pdf/cond-mat/0011267v2" rel="related" type="application/pdf"/>
    <arxiv:primary_category xmlns:arxiv="http://arxiv.org/schemas/atom" term="cond-mat" scheme="http://arxiv.org/schemas/atom"/>
    <category term="cond-mat" scheme="http://arxiv.org/schemas/atom"/>
  </entry>
</feed>
```

- [ ] **Step 2: Write the failing parser test.** Create `test/core/parse/atom.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFeed } from "../../../src/core/parse/atom.js";

const fixture = (name: string): string =>
  readFileSync(join(__dirname, "..", "..", "fixtures", name), "utf8");

describe("parseFeed (single entry)", () => {
  const result = parseFeed(fixture("atom-single.xml"));

  it("maps OpenSearch paging fields", () => {
    expect(result.total).toBe(1);
    expect(result.start).toBe(0);
    expect(result.count).toBe(1);
  });

  it("wraps a single entry into a one-element papers array (isArray shape)", () => {
    expect(Array.isArray(result.papers)).toBe(true);
    expect(result.papers).toHaveLength(1);
  });

  it("derives canonical id, version, and idWithVersion from the entry id URL", () => {
    const p = result.papers[0];
    expect(p.id).toBe("2310.06825");
    expect(p.version).toBe(1);
    expect(p.idWithVersion).toBe("2310.06825v1");
  });

  it("trims title and summary", () => {
    const p = result.papers[0];
    expect(p.title).toBe("Mistral 7B");
    expect(p.summary).toBe(
      "We introduce Mistral 7B, a 7-billion-parameter language model.",
    );
  });

  it("maps authors with optional affiliation", () => {
    const p = result.papers[0];
    expect(p.authors).toEqual([
      { name: "Albert Q. Jiang", affiliation: "Mistral AI" },
      { name: "Alexandre Sablayrolles" },
    ]);
  });

  it("maps categories and primary category", () => {
    const p = result.papers[0];
    expect(p.categories).toEqual(["cs.CL", "cs.AI", "cs.LG"]);
    expect(p.primaryCategory).toBe("cs.CL");
  });

  it("carries published/updated and optional doi/journalRef/comment", () => {
    const p = result.papers[0];
    expect(p.published).toBe("2023-10-10T17:54:09Z");
    expect(p.updated).toBe("2023-10-10T17:54:09Z");
    expect(p.doi).toBe("10.1000/xyz123");
    expect(p.journalRef).toBe("Proc. of FooConf 2023");
    expect(p.comment).toBe("Models and code available");
  });

  it("maps abs and pdf links", () => {
    const p = result.papers[0];
    expect(p.links.abs).toBe("http://arxiv.org/abs/2310.06825v1");
    expect(p.links.pdf).toBe("http://arxiv.org/pdf/2310.06825v1");
  });
});

describe("parseFeed (multi entry)", () => {
  const result = parseFeed(fixture("atom-multi.xml"));

  it("maps paging and parses every entry", () => {
    expect(result.total).toBe(42);
    expect(result.papers).toHaveLength(2);
  });

  it("preserves document order", () => {
    expect(result.papers[0].id).toBe("2310.06825");
    expect(result.papers[1].id).toBe("cond-mat/0011267");
  });

  it("handles an old-style id (slash kept) with version", () => {
    const p = result.papers[1];
    expect(p.id).toBe("cond-mat/0011267");
    expect(p.version).toBe(2);
    expect(p.idWithVersion).toBe("cond-mat/0011267v2");
  });

  it("leaves optional fields undefined when absent", () => {
    const p = result.papers[1];
    expect(p.doi).toBeUndefined();
    expect(p.journalRef).toBeUndefined();
    expect(p.comment).toBeUndefined();
    expect(p.authors).toEqual([{ name: "Jane Doe" }]);
  });

  it("single-category entry still yields an array", () => {
    expect(result.papers[1].categories).toEqual(["cond-mat"]);
  });
});

describe("parseFeed (zero results)", () => {
  const empty = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">
  <opensearch:totalResults>0</opensearch:totalResults>
  <opensearch:startIndex>0</opensearch:startIndex>
  <opensearch:itemsPerPage>0</opensearch:itemsPerPage>
</feed>`;

  it("returns empty papers without throwing", () => {
    const result = parseFeed(empty);
    expect(result.total).toBe(0);
    expect(result.papers).toEqual([]);
  });
});
```

- [ ] **Step 3: Run the test, expect FAIL.** Run: `npx vitest run test/core/parse/atom.test.ts`. Expected: FAIL — `Cannot find module '../../../src/core/parse/atom.js'`.

- [ ] **Step 4: Implement src/core/parse/atom.ts.** Create the file. Complete contents:

```ts
import { XMLParser } from "fast-xml-parser";
import { normalizeId } from "../ids.js";
import { ParseError } from "../errors.js";
import type { Author, Paper, SearchResult } from "../types.js";

const parser = new XMLParser({
  removeNSPrefix: true,
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  // Predicate (NOT a blanket () => true): force these elements to arrays so a
  // single-entry feed still yields entry/author/category/link as arrays.
  isArray: (name) => ["entry", "author", "category", "link"].includes(name),
});

const asArray = <T>(v: T | T[] | undefined): T[] =>
  v === undefined ? [] : Array.isArray(v) ? v : [v];

/** fast-xml-parser yields a string for text nodes, or an object with #text when
 * attributes are present. Normalize to a trimmed string (or undefined). */
const textOf = (v: unknown): string | undefined => {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return String(v);
  if (typeof v === "object" && "#text" in (v as Record<string, unknown>)) {
    const t = (v as Record<string, unknown>)["#text"];
    return t === undefined ? undefined : String(t).trim();
  }
  return undefined;
};

const num = (v: unknown): number => {
  const n = Number(textOf(v) ?? v);
  return Number.isFinite(n) ? n : 0;
};

interface RawLink {
  "@_href"?: string;
  "@_rel"?: string;
  "@_type"?: string;
  "@_title"?: string;
}

interface RawAuthor {
  name?: unknown;
  affiliation?: unknown;
}

interface RawCategory {
  "@_term"?: string;
}

interface RawEntry {
  id?: unknown;
  title?: unknown;
  summary?: unknown;
  published?: unknown;
  updated?: unknown;
  author?: RawAuthor[];
  category?: RawCategory[];
  primary_category?: { "@_term"?: string };
  doi?: unknown;
  journal_ref?: unknown;
  comment?: unknown;
  link?: RawLink[];
}

function mapAuthors(raw: RawAuthor[]): Author[] {
  return raw.map((a) => {
    const author: Author = { name: textOf(a.name) ?? "" };
    const aff = textOf(a.affiliation);
    if (aff) author.affiliation = aff;
    return author;
  });
}

function mapLinks(
  raw: RawLink[],
  entryId: string,
): Paper["links"] {
  let abs: string | undefined;
  let pdf: string | undefined;
  let html: string | undefined;
  for (const l of raw) {
    const href = l["@_href"];
    if (!href) continue;
    if (l["@_title"] === "pdf") {
      pdf = href;
    } else if (l["@_rel"] === "alternate" && l["@_type"] === "text/html") {
      abs = href;
    } else if (
      l["@_rel"] === "related" &&
      l["@_type"] === "text/html" &&
      l["@_title"] !== "pdf"
    ) {
      html = href;
    }
  }
  const links: Paper["links"] = {
    abs: abs ?? entryId,
    pdf: pdf ?? entryId.replace("/abs/", "/pdf/"),
  };
  if (html) links.html = html;
  return links;
}

function mapEntry(e: RawEntry): Paper {
  const rawId = textOf(e.id);
  if (!rawId) throw new ParseError("Atom entry is missing an id");
  const norm = normalizeId(rawId);

  const paper: Paper = {
    id: norm.id,
    title: textOf(e.title) ?? "",
    summary: textOf(e.summary) ?? "",
    authors: mapAuthors(asArray(e.author)),
    categories: asArray(e.category)
      .map((c) => c["@_term"])
      .filter((t): t is string => typeof t === "string"),
    primaryCategory: e.primary_category?.["@_term"] ?? "",
    published: textOf(e.published) ?? "",
    updated: textOf(e.updated) ?? "",
    links: mapLinks(asArray(e.link), rawId),
  };

  if (norm.version !== undefined) {
    paper.version = norm.version;
    paper.idWithVersion = norm.idWithVersion;
  }
  const doi = textOf(e.doi);
  if (doi) paper.doi = doi;
  const journalRef = textOf(e.journal_ref);
  if (journalRef) paper.journalRef = journalRef;
  const comment = textOf(e.comment);
  if (comment) paper.comment = comment;

  return paper;
}

/** Parse an arXiv Atom feed into a SearchResult (paging + papers). */
export function parseFeed(xml: string): SearchResult {
  let doc: { feed?: Record<string, unknown> };
  try {
    doc = parser.parse(xml) as { feed?: Record<string, unknown> };
  } catch (err) {
    throw new ParseError(`Failed to parse Atom feed: ${String(err)}`);
  }
  const feed = doc.feed;
  if (!feed) throw new ParseError("Atom feed has no <feed> root");

  const entries = asArray(feed.entry as RawEntry | RawEntry[] | undefined);
  return {
    total: num(feed.totalResults),
    start: num(feed.startIndex),
    count: num(feed.itemsPerPage),
    papers: entries.map(mapEntry),
  };
}
```

- [ ] **Step 5: Run the test, expect PASS.** Run: `npx vitest run test/core/parse/atom.test.ts`. Expected: PASS — single- and multi-entry parsing, namespaced fields, old-style id, optional-field omission, zero-result feed.

- [ ] **Step 6: Run typecheck.** Run: `npx tsc --noEmit`. Expected: PASS (no errors originating in `src/core/parse/atom.ts`).

- [ ] **Step 7: Commit.** Run:
```
git add src/core/parse/atom.ts test/core/parse/atom.test.ts test/fixtures/atom-single.xml test/fixtures/atom-multi.xml && git commit -m "feat(core): parse arXiv Atom feeds into SearchResult

- parseFeed maps OpenSearch totalResults/startIndex/itemsPerPage and each
  entry into a Paper (canonical id/version via normalizeId, authors with
  optional affiliation, categories, primary category, links, optional
  doi/journal_ref/comment).
- fast-xml-parser configured with removeNSPrefix, ignoreAttributes:false, and
  the isArray predicate for entry/author/category/link (not a blanket predicate).
- Single- and multi-entry fixtures lock the array shape; zero-result feed safe.
"
```

---

### Task B: DataSource interface + ApiDataSource (src/core/datasource/datasource.ts, src/core/datasource/api.ts)

**Files:**
- Source: `/Users/aildan/arxiv/src/core/datasource/datasource.ts` (Create)
- Source: `/Users/aildan/arxiv/src/core/datasource/api.ts` (Create)
- Test: `/Users/aildan/arxiv/test/core/datasource/api.test.ts` (Create)
- Commit: `src/core/datasource/datasource.ts`, `src/core/datasource/api.ts`, `test/core/datasource/api.test.ts`

**Interfaces:**
- Consumes: `Http` from `../http.js` (`getText(url): Promise<string|null>`, `getBytes(url): Promise<Uint8Array>`); `NetworkError`, `NotFoundError` from `../errors.js`.
- Produces:
  - `export interface DataSource` — the frozen transport seam (contracts §3): `query(url): Promise<string>`, `getHtml(url): Promise<string | null>`, `getPdf(url): Promise<Uint8Array>`, `getText(url): Promise<string>`.
  - `export class ApiDataSource implements DataSource` — `constructor(http: Http)`; `query` → `http.getText`, throw `NetworkError` if `null`; `getHtml` → `http.getText` (passes `null` through); `getPdf` → `http.getBytes`; `getText` → `http.getText`, throw `NotFoundError` if `null`.

**Notes for the implementer:** `datasource.ts` is the frozen interface transcribed verbatim from contracts §3 — it builds nothing and parses nothing. The client owns URL building and fallback order. `ApiDataSource` is a thin wrapper; the test injects a hand-rolled fake `Http` (only `getText`/`getBytes` need to exist) rather than the real `Http`, so no network and no `RateLimiter`.

- [ ] **Step 1: Write the frozen DataSource interface.** Create `src/core/datasource/datasource.ts`. Complete contents (verbatim from contracts §3):

```ts
export interface DataSource {
  /** GET an Atom feed (the /api/query endpoint); returns the XML text. */
  query(url: string): Promise<string>;
  /** GET an HTML page; resolves to `null` on HTTP 404 (drives the source-fallback matrix). */
  getHtml(url: string): Promise<string | null>;
  /** GET PDF bytes; throws NotFoundError on 404. */
  getPdf(url: string): Promise<Uint8Array>;
  /** GET arbitrary text (e.g. the bibtex endpoint); throws NotFoundError on 404. */
  getText(url: string): Promise<string>;
}
```

- [ ] **Step 2: Write the failing ApiDataSource test.** Create `test/core/datasource/api.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { ApiDataSource } from "../../../src/core/datasource/api.js";
import type { Http } from "../../../src/core/http.js";

function fakeHttp(over: Partial<Http> = {}): Http {
  return {
    getText: vi.fn(async () => null),
    getBytes: vi.fn(async () => new Uint8Array()),
    ...over,
  } as unknown as Http;
}

describe("ApiDataSource", () => {
  it("query returns the Atom text from http.getText", async () => {
    const http = fakeHttp({ getText: vi.fn(async () => "<feed/>") as Http["getText"] });
    const ds = new ApiDataSource(http);
    expect(await ds.query("https://export.arxiv.org/api/query?x=1")).toBe("<feed/>");
  });

  it("query throws NetworkError when http.getText returns null (404)", async () => {
    const http = fakeHttp({ getText: vi.fn(async () => null) as Http["getText"] });
    const ds = new ApiDataSource(http);
    await expect(ds.query("https://export.arxiv.org/api/query?x=1")).rejects.toMatchObject({
      code: "NETWORK",
    });
  });

  it("getHtml passes null through on 404", async () => {
    const http = fakeHttp({ getText: vi.fn(async () => null) as Http["getText"] });
    const ds = new ApiDataSource(http);
    expect(await ds.getHtml("https://arxiv.org/html/0000.00000")).toBeNull();
  });

  it("getHtml returns the HTML body on 200", async () => {
    const http = fakeHttp({ getText: vi.fn(async () => "<html/>") as Http["getText"] });
    const ds = new ApiDataSource(http);
    expect(await ds.getHtml("https://arxiv.org/html/2310.06825")).toBe("<html/>");
  });

  it("getPdf delegates to http.getBytes", async () => {
    const bytes = new Uint8Array([37, 80, 68, 70]);
    const http = fakeHttp({ getBytes: vi.fn(async () => bytes) as Http["getBytes"] });
    const ds = new ApiDataSource(http);
    expect(await ds.getPdf("https://arxiv.org/pdf/2310.06825.pdf")).toBe(bytes);
  });

  it("getText returns the text on 200", async () => {
    const http = fakeHttp({ getText: vi.fn(async () => "@misc{...}") as Http["getText"] });
    const ds = new ApiDataSource(http);
    expect(await ds.getText("https://arxiv.org/bibtex/2310.06825")).toBe("@misc{...}");
  });

  it("getText throws NotFoundError when http.getText returns null (404)", async () => {
    const http = fakeHttp({ getText: vi.fn(async () => null) as Http["getText"] });
    const ds = new ApiDataSource(http);
    await expect(ds.getText("https://arxiv.org/bibtex/0000.00000")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
```

- [ ] **Step 3: Run the test, expect FAIL.** Run: `npx vitest run test/core/datasource/api.test.ts`. Expected: FAIL — `Cannot find module '../../../src/core/datasource/api.js'`.

- [ ] **Step 4: Implement src/core/datasource/api.ts.** Create the file. Complete contents:

```ts
import { NetworkError, NotFoundError } from "../errors.js";
import type { Http } from "../http.js";
import type { DataSource } from "./datasource.js";

/**
 * Default DataSource over arXiv's official endpoints. A thin transport: it
 * builds no URLs and parses nothing — the client decides URLs and fallback
 * order; parsing lives in core/parse/*.
 */
export class ApiDataSource implements DataSource {
  private readonly http: Http;

  constructor(http: Http) {
    this.http = http;
  }

  async query(url: string): Promise<string> {
    const text = await this.http.getText(url);
    if (text === null) {
      throw new NetworkError(`Query endpoint returned no body: ${url}`);
    }
    return text;
  }

  async getHtml(url: string): Promise<string | null> {
    return this.http.getText(url);
  }

  async getPdf(url: string): Promise<Uint8Array> {
    return this.http.getBytes(url);
  }

  async getText(url: string): Promise<string> {
    const text = await this.http.getText(url);
    if (text === null) {
      throw new NotFoundError(`Not found: ${url}`);
    }
    return text;
  }
}
```

- [ ] **Step 5: Run the test, expect PASS.** Run: `npx vitest run test/core/datasource/api.test.ts`. Expected: PASS — query/getHtml/getPdf/getText delegation and 404 semantics (query→NetworkError, getHtml→null, getText→NotFoundError) all green.

- [ ] **Step 6: Run typecheck.** Run: `npx tsc --noEmit`. Expected: PASS (no errors originating in `src/core/datasource/*.ts`).

- [ ] **Step 7: Commit.** Run:
```
git add src/core/datasource/datasource.ts src/core/datasource/api.ts test/core/datasource/api.test.ts && git commit -m "feat(core): add DataSource seam and ApiDataSource transport

- datasource.ts: frozen DataSource interface (query/getHtml/getPdf/getText).
- ApiDataSource wraps Http: query->getText (NetworkError on null),
  getHtml->getText passthrough, getPdf->getBytes, getText->getText
  (NotFoundError on null).
- Tested with an injected fake Http (no network).
"
```

---

### Task C: Search query builder + ArxivClient (src/core/client.ts)

**Files:**
- Source: `/Users/aildan/arxiv/src/core/client.ts` (Create — skeleton + Phase 4 methods)
- Test: `/Users/aildan/arxiv/test/core/client.test.ts` (Create)
- Commit: `src/core/client.ts`, `test/core/client.test.ts`

**Interfaces:**
- Consumes: `resolveConfig` from `./config.js`; `RateLimiter` from `./rate-limit.js`; `Cache` from `./cache.js`; `Http` from `./http.js`; `ApiDataSource` from `./datasource/api.js`; `DataSource` (type) from `./datasource/datasource.js`; `parseFeed` from `./parse/atom.js`; `normalizeId` from `./ids.js`; `ParseError` from `./errors.js`; all domain types from `./types.js`.
- Produces: `export class ArxivClient` with the **exact** constructor/field set from contracts §4, plus implemented `search`/`getPaper`/`getPapers`/`recent` and the frozen one-line stub bodies for `getContent`/`download`/`toBibTeX`.

**Notes for the implementer:**
- **Constructor wiring is frozen** (contracts §4): `Http` is built **without** a cache; the client owns the structured `Cache` (or `undefined` when `noCache`). Do not pass `this.cache` into `Http`.
- **search_query builder (spec §7.1):** `query` → `all:"<query>"`; each provided field → `ti:`/`au:`/`abs:`/`cat:` clause; all clauses ANDed. **If neither `query` nor any field clause is produced AND no `ids` are given → throw `ParseError`** (usage error). A search with only `ids` (and no query/fields) is valid (id_list lookup) and emits **no** `search_query`.
- **Term encoding (spec §5.1):** wrap each clause's term in `%22…%22` (the encoded double-quote) so multi-word phrases group; within the quoted term, spaces → `+`, `(` → `%28`, `)` → `%29`. Clauses are joined with `+AND+`. The whole `search_query` value is emitted **pre-encoded** (do not run it through `encodeURIComponent` again). `id_list` is the raw comma-joined canonical ids (slash kept, never `%2F`). `start`/`max_results`/`sortBy`/`sortOrder` are appended as plain params.
- **maxResults:** default from `cfg.defaultMaxResults`; clamp to ≤ 2000 (fixed constant). `start` defaults to 0.
- **hints:** when `total > 1000`, push one hint string ("N results — narrow by category/date").
- **recent:** delegates to `search({ category, sortBy: "submittedDate", sortOrder: "descending", maxResults })`.
- **getPapers:** chunk `ids` into ≤ 50 per `id_list` request; concatenate parsed papers; **return in input order** (sort the union by the input index, dropping ids arXiv did not return); ids omitted by arXiv are collected and surfaced via a single `console.warn` (no throw). `getPaper` = first element of `getPapers([id])`, or `NotFoundError` if empty.
- **Caching (contracts §6):** search → key `{ kind: "search", paramsHash }`, TTL 1h (`this.cache?.get`/`set`, guarded). metadata → key `{ kind: "meta", id, version }`. `paramsHash` is the normalized param object; pass the object as the key and let `Cache` hash it.
- **Stub bodies are frozen one-liners** so Phases 6/7 replace exactly those lines.

- [ ] **Step 1: Write the failing client test.** Create `test/core/client.test.ts`. It subclasses/constructs `ArxivClient` with `noCache: true` (so `this.cache` is `undefined`) and replaces the private `api` with a fake `DataSource` via a typed cast, capturing the `query` URL.

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ArxivClient } from "../../src/core/client.js";
import type { DataSource } from "../../src/core/datasource/datasource.js";

const fixture = (name: string): string =>
  readFileSync(join(__dirname, "..", "fixtures", name), "utf8");

interface Captured {
  urls: string[];
}

/** Build a client whose ApiDataSource is replaced by a fake that records query
 * URLs and returns the given Atom feeds in sequence (one per query call). */
function clientWithFeeds(feeds: string[]): { client: ArxivClient; cap: Captured } {
  const cap: Captured = { urls: [] };
  const client = new ArxivClient({ noCache: true, defaultMaxResults: 25 });
  let i = 0;
  const fake: DataSource = {
    async query(url: string) {
      cap.urls.push(url);
      const feed = feeds[Math.min(i, feeds.length - 1)];
      i++;
      return feed;
    },
    async getHtml() {
      return null;
    },
    async getPdf() {
      return new Uint8Array();
    },
    async getText() {
      return "";
    },
  };
  // Inject the fake over the private `api` field.
  (client as unknown as { api: DataSource }).api = fake;
  return { client, cap };
}

describe("ArxivClient.search query building", () => {
  it("emits all:<query> for a free-text query", async () => {
    const { client, cap } = clientWithFeeds([fixture("atom-single.xml")]);
    await client.search({ query: "mistral" });
    expect(cap.urls[0]).toContain("search_query=all:%22mistral%22");
    expect(cap.urls[0]).toContain("start=0");
    expect(cap.urls[0]).toContain("max_results=25");
  });

  it("ANDs free-text with field clauses and quotes multi-word terms", async () => {
    const { client, cap } = clientWithFeeds([fixture("atom-single.xml")]);
    await client.search({ query: "language model", author: "Jiang", category: "cs.CL" });
    const url = cap.urls[0];
    expect(url).toContain("all:%22language+model%22");
    expect(url).toContain("au:%22Jiang%22");
    expect(url).toContain("cat:%22cs.CL%22");
    expect(url).toContain("+AND+");
  });

  it("clamps maxResults to 2000", async () => {
    const { client, cap } = clientWithFeeds([fixture("atom-single.xml")]);
    await client.search({ query: "x", maxResults: 9999 });
    expect(cap.urls[0]).toContain("max_results=2000");
  });

  it("uses cfg.defaultMaxResults when maxResults omitted", async () => {
    const cap: Captured = { urls: [] };
    const client = new ArxivClient({ noCache: true, defaultMaxResults: 7 });
    const fake: DataSource = {
      async query(url: string) {
        cap.urls.push(url);
        return fixture("atom-single.xml");
      },
      async getHtml() { return null; },
      async getPdf() { return new Uint8Array(); },
      async getText() { return ""; },
    };
    (client as unknown as { api: DataSource }).api = fake;
    await client.search({ query: "x" });
    expect(cap.urls[0]).toContain("max_results=7");
  });

  it("applies sortBy/sortOrder/start", async () => {
    const { client, cap } = clientWithFeeds([fixture("atom-single.xml")]);
    await client.search({ query: "x", sortBy: "submittedDate", sortOrder: "ascending", start: 50 });
    const url = cap.urls[0];
    expect(url).toContain("sortBy=submittedDate");
    expect(url).toContain("sortOrder=ascending");
    expect(url).toContain("start=50");
  });

  it("throws ParseError when neither query, field, nor ids are given", async () => {
    const { client } = clientWithFeeds([fixture("atom-single.xml")]);
    await expect(client.search({})).rejects.toMatchObject({ code: "PARSE" });
  });

  it("allows an ids-only search (id_list, no search_query)", async () => {
    const { client, cap } = clientWithFeeds([fixture("atom-single.xml")]);
    await client.search({ ids: ["2310.06825"] });
    const url = cap.urls[0];
    expect(url).toContain("id_list=2310.06825");
    expect(url).not.toContain("search_query=");
  });

  it("keeps the literal slash in old-style id_list (no %2F)", async () => {
    const { client, cap } = clientWithFeeds([fixture("atom-multi.xml")]);
    await client.search({ ids: ["cond-mat/0011267"] });
    expect(cap.urls[0]).toContain("id_list=cond-mat/0011267");
    expect(cap.urls[0]).not.toContain("%2F");
  });

  it("parses the feed into a SearchResult", async () => {
    const { client } = clientWithFeeds([fixture("atom-single.xml")]);
    const res = await client.search({ query: "mistral" });
    expect(res.total).toBe(1);
    expect(res.papers[0].id).toBe("2310.06825");
  });
});

describe("ArxivClient.search hints", () => {
  it("pushes a hint when total > 1000", async () => {
    const big = fixture("atom-single.xml").replace(
      ">1</opensearch:totalResults>",
      ">1200</opensearch:totalResults>",
    );
    const { client } = clientWithFeeds([big]);
    const res = await client.search({ query: "transformer" });
    expect(res.total).toBe(1200);
    expect(res.hints?.[0]).toMatch(/narrow/i);
  });

  it("omits hints when total <= 1000", async () => {
    const { client } = clientWithFeeds([fixture("atom-single.xml")]);
    const res = await client.search({ query: "mistral" });
    expect(res.hints).toBeUndefined();
  });
});

describe("ArxivClient.recent", () => {
  it("maps to a submittedDate/descending category search", async () => {
    const { client, cap } = clientWithFeeds([fixture("atom-multi.xml")]);
    await client.recent("cs.CL", { maxResults: 10 });
    const url = cap.urls[0];
    expect(url).toContain("cat:%22cs.CL%22");
    expect(url).toContain("sortBy=submittedDate");
    expect(url).toContain("sortOrder=descending");
    expect(url).toContain("max_results=10");
  });
});

describe("ArxivClient.getPaper(s)", () => {
  it("getPaper returns the single matching Paper", async () => {
    const { client } = clientWithFeeds([fixture("atom-single.xml")]);
    const paper = await client.getPaper("2310.06825");
    expect(paper.id).toBe("2310.06825");
    expect(paper.title).toBe("Mistral 7B");
  });

  it("getPapers returns papers in input order", async () => {
    // atom-multi has 2310.06825 then cond-mat/0011267; request reversed order.
    const { client } = clientWithFeeds([fixture("atom-multi.xml")]);
    const papers = await client.getPapers(["cond-mat/0011267", "2310.06825"]);
    expect(papers.map((p) => p.id)).toEqual(["cond-mat/0011267", "2310.06825"]);
  });

  it("getPapers warns about omitted ids without throwing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { client } = clientWithFeeds([fixture("atom-single.xml")]);
    const papers = await client.getPapers(["2310.06825", "9999.99999"]);
    expect(papers.map((p) => p.id)).toEqual(["2310.06825"]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("getPapers batches into <=50-id requests", async () => {
    const ids = Array.from({ length: 120 }, (_, i) => `2310.${String(10000 + i)}`);
    const cap: Captured = { urls: [] };
    const client = new ArxivClient({ noCache: true });
    const fake: DataSource = {
      async query(url: string) {
        cap.urls.push(url);
        // empty feed (no entries) — we only assert the batching, not the contents
        return `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><opensearch:totalResults xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">0</opensearch:totalResults><opensearch:startIndex xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">0</opensearch:startIndex><opensearch:itemsPerPage xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">0</opensearch:itemsPerPage></feed>`;
      },
      async getHtml() { return null; },
      async getPdf() { return new Uint8Array(); },
      async getText() { return ""; },
    };
    (client as unknown as { api: DataSource }).api = fake;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await client.getPapers(ids);
    warn.mockRestore();
    expect(cap.urls).toHaveLength(3); // 50 + 50 + 20
    expect(cap.urls[0]).toContain("max_results=50");
  });
});

describe("ArxivClient stubs", () => {
  it("getContent/download/toBibTeX throw their phase markers", async () => {
    const { client } = clientWithFeeds([fixture("atom-single.xml")]);
    await expect(client.getContent("2310.06825")).rejects.toThrow("Phase 6");
    await expect(client.download("2310.06825")).rejects.toThrow("Phase 6");
    await expect(client.toBibTeX("2310.06825")).rejects.toThrow("Phase 7");
  });
});
```

- [ ] **Step 2: Run the test, expect FAIL.** Run: `npx vitest run test/core/client.test.ts`. Expected: FAIL — `Cannot find module '../../src/core/client.js'`.

- [ ] **Step 3: Implement src/core/client.ts.** Create the file. Complete contents:

```ts
import { resolveConfig } from "./config.js";
import { RateLimiter } from "./rate-limit.js";
import { Cache } from "./cache.js";
import { Http } from "./http.js";
import { ApiDataSource } from "./datasource/api.js";
import { parseFeed } from "./parse/atom.js";
import { normalizeId } from "./ids.js";
import { NotFoundError, ParseError } from "./errors.js";
import type { DataSource } from "./datasource/datasource.js";
import type {
  ArxivConfig,
  SearchParams,
  SearchResult,
  Paper,
  PaperContent,
  ReadOptions,
  DownloadOptions,
} from "./types.js";

const API_QUERY_URL = "https://export.arxiv.org/api/query";
const MAX_RESULTS_CLAMP = 2000;
const ID_LIST_BATCH = 50;
const SEARCH_TTL_MS = 60 * 60 * 1000; // 1h
const META_TTL_LATEST_MS = 24 * 60 * 60 * 1000; // 24h

/** Encode a single search term: quote-wrap (group multi-word phrases), spaces
 * to "+", parentheses to their encoded forms. The whole search_query value is
 * emitted pre-encoded (spec §5.1). */
function encodeTerm(term: string): string {
  const inner = term.trim().replace(/\(/g, "%28").replace(/\)/g, "%29").replace(/\s+/g, "+");
  return `%22${inner}%22`;
}

/** Build the pre-encoded search_query value (or "" when only id_list applies). */
function buildSearchQuery(params: SearchParams): string {
  const clauses: string[] = [];
  if (params.query && params.query.trim()) clauses.push(`all:${encodeTerm(params.query)}`);
  if (params.title && params.title.trim()) clauses.push(`ti:${encodeTerm(params.title)}`);
  if (params.author && params.author.trim()) clauses.push(`au:${encodeTerm(params.author)}`);
  if (params.abstract && params.abstract.trim()) clauses.push(`abs:${encodeTerm(params.abstract)}`);
  if (params.category && params.category.trim()) clauses.push(`cat:${encodeTerm(params.category)}`);
  return clauses.join("+AND+");
}

export class ArxivClient {
  private readonly cfg: ArxivConfig;
  private readonly cache?: Cache;
  private readonly http: Http;
  private readonly api: DataSource;
  private browser?: DataSource; // lazily constructed in Phase 10 when browserFallback engages

  constructor(config?: Partial<ArxivConfig>) {
    this.cfg = resolveConfig(config);
    const limiter = new RateLimiter(this.cfg.rateMs);
    this.cache = this.cfg.noCache ? undefined : new Cache(this.cfg.cacheDir);
    this.http = new Http(this.cfg, limiter); // structured caching is at the client level
    this.api = new ApiDataSource(this.http);
  }

  private buildQueryUrl(params: SearchParams): string {
    const searchQuery = buildSearchQuery(params);
    const hasIds = params.ids !== undefined && params.ids.length > 0;
    if (!searchQuery && !hasIds) {
      throw new ParseError(
        "search requires at least one of: query, title, author, abstract, category, or ids",
      );
    }
    const maxResults = Math.min(
      MAX_RESULTS_CLAMP,
      Math.max(1, params.maxResults ?? this.cfg.defaultMaxResults),
    );
    const start = params.start ?? 0;
    const parts: string[] = [];
    if (searchQuery) parts.push(`search_query=${searchQuery}`);
    if (hasIds) {
      // Canonical ids keep the literal slash (old-style) — never %2F.
      const idList = params.ids!.map((id) => normalizeId(id).idWithVersion ?? normalizeId(id).id).join(",");
      parts.push(`id_list=${idList}`);
    }
    parts.push(`start=${start}`);
    parts.push(`max_results=${maxResults}`);
    if (params.sortBy) parts.push(`sortBy=${params.sortBy}`);
    if (params.sortOrder) parts.push(`sortOrder=${params.sortOrder}`);
    return `${API_QUERY_URL}?${parts.join("&")}`;
  }

  async search(params: SearchParams): Promise<SearchResult> {
    const url = this.buildQueryUrl(params); // throws ParseError on empty params
    const cacheKey = { kind: "search" as const, paramsHash: params };
    const cached = await this.cache?.get<SearchResult>(cacheKey);
    if (cached) return cached;

    const xml = await this.api.query(url);
    const result = parseFeed(xml);
    if (result.total > 1000) {
      result.hints = [
        `${result.total} results — narrow by category/date to refine.`,
      ];
    }
    await this.cache?.set(cacheKey, result, SEARCH_TTL_MS);
    return result;
  }

  async getPaper(id: string): Promise<Paper> {
    const papers = await this.getPapers([id]);
    if (papers.length === 0) {
      throw new NotFoundError(`Paper not found: ${id}`);
    }
    return papers[0];
  }

  async getPapers(ids: string[]): Promise<Paper[]> {
    if (ids.length === 0) return [];
    // Fetch in <=50-id batches; collect all returned papers.
    const found = new Map<string, Paper>();
    for (let i = 0; i < ids.length; i += ID_LIST_BATCH) {
      const batch = ids.slice(i, i + ID_LIST_BATCH);
      const result = await this.search({ ids: batch, maxResults: batch.length });
      for (const paper of result.papers) found.set(paper.id, paper);
    }
    // Re-order to input order; drop ids arXiv did not return; warn about omissions.
    const ordered: Paper[] = [];
    const omitted: string[] = [];
    for (const raw of ids) {
      const canonical = normalizeId(raw).id;
      const paper = found.get(canonical);
      if (paper) ordered.push(paper);
      else omitted.push(raw);
    }
    if (omitted.length > 0) {
      console.warn(`arXiv did not return metadata for: ${omitted.join(", ")}`);
    }
    return ordered;
  }

  async recent(category: string, opts?: { maxResults?: number }): Promise<SearchResult> {
    return this.search({
      category,
      sortBy: "submittedDate",
      sortOrder: "descending",
      maxResults: opts?.maxResults,
    });
  }

  // Phase 6:
  async getContent(id: string, opts?: ReadOptions): Promise<PaperContent> { throw new Error("getContent: implemented in Phase 6"); }
  async download(id: string, opts?: DownloadOptions): Promise<{ path: string; bytes: number }> { throw new Error("download: implemented in Phase 6"); }

  // Phase 7:
  async toBibTeX(id: string): Promise<string> { throw new Error("toBibTeX: implemented in Phase 7"); }
}
```

- [ ] **Step 4: Run the test, expect PASS.** Run: `npx vitest run test/core/client.test.ts`. Expected: PASS — query building (all/field clauses, AND, quoting), clamp, default max, sort/start, ids-only, slash kept, parse, hints, recent mapping, getPaper(s) order + omitted-warning + batching, and stub phase markers all green.

- [ ] **Step 5: Run the full core suite and typecheck.** Run: `npx vitest run test/core` then `npx tsc --noEmit`. Expected: PASS (atom, datasource/api, and client suites all green; no type errors originating in `src/core/client.ts`). The frozen stub bodies (`getContent`/`download`/`toBibTeX`) typecheck because they `throw` before returning; the unused `opts`/`id` params are intentional (Phases 6/7 use them).

- [ ] **Step 6: Commit.** Run:
```
git add src/core/client.ts test/core/client.test.ts && git commit -m "feat(core): add ArxivClient with search/getPaper(s)/recent

- search_query builder: all:<query> ANDed with ti/au/abs/cat field clauses,
  multi-word terms quote-wrapped, paren/space encoded, emitted pre-encoded;
  usage error (ParseError) when no query/field/ids given.
- maxResults defaults to cfg.defaultMaxResults, clamped to <=2000; start/sortBy/
  sortOrder applied; id_list keeps the literal old-style slash (no %2F).
- parseFeed -> SearchResult; hint pushed when total > 1000.
- getPapers batches <=50 ids per request, returns input order, warns (no throw)
  on omitted ids; getPaper wraps getPapers; recent maps to submittedDate/desc.
- Structured client-level caching (search key TTL 1h), guarded for noCache.
- getContent/download (Phase 6) and toBibTeX (Phase 7) left as frozen stubs.
"
```
