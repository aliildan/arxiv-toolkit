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
