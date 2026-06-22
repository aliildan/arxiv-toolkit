import { resolveConfig } from "./config.js";
import { RateLimiter } from "./rate-limit.js";
import { Cache } from "./cache.js";
import { Http } from "./http.js";
import { ApiDataSource } from "./datasource/api.js";
import { parseFeed } from "./parse/atom.js";
import { normalizeId, htmlUrl, ar5ivUrl, pdfUrl, filenameFor, bibtexUrl } from "./ids.js";
import { generateBibTeX } from "./bibtex.js";
import { NotFoundError, ParseError, UnsupportedError, NetworkError, RateLimitedError } from "./errors.js";
import type { DataSource } from "./datasource/datasource.js";
import { BrowserDataSource } from "./datasource/browser.js";
import type {
  ArxivConfig,
  SearchParams,
  SearchResult,
  Paper,
  PaperContent,
  ReadOptions,
  DownloadOptions,
  Section,
  NormalizedId,
} from "./types.js";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseNativeHtml } from "./parse/html-native.js";
import { parseAr5ivHtml } from "./parse/html-ar5iv.js";
import { parsePdf } from "./parse/pdf.js";
import { markdownToText } from "./parse/html-common.js";

const API_QUERY_URL = "https://export.arxiv.org/api/query";
const MAX_RESULTS_CLAMP = 2000;
const ID_LIST_BATCH = 50;
const SEARCH_TTL_MS = 60 * 60 * 1000; // 1h

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

  /** Override in tests to inject a fake browser DataSource without real playwright. */
  protected makeBrowserSource(): DataSource {
    return new BrowserDataSource();
  }

  private async htmlWithBrowserFallback(url: string): Promise<string | null> {
    try {
      return await this.api.getHtml(url);
    } catch (err) {
      if (
        this.cfg.browserFallback &&
        (err instanceof NetworkError || err instanceof RateLimitedError)
      ) {
        this.browser ??= this.makeBrowserSource();
        return this.browser.getHtml(url);
      }
      throw err;
    }
  }

  private async pdfWithBrowserFallback(url: string): Promise<Uint8Array> {
    try {
      return await this.api.getPdf(url);
    } catch (err) {
      if (
        this.cfg.browserFallback &&
        (err instanceof NetworkError || err instanceof RateLimitedError)
      ) {
        this.browser ??= this.makeBrowserSource();
        return this.browser.getPdf(url);
      }
      throw err;
    }
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
      const idList = params.ids!.map((id) => { const n = normalizeId(id); return n.idWithVersion ?? n.id; }).join(",");
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
    const cacheKey = { kind: "search" as const, normalizedParamsHash: url };
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
      const html = await this.htmlWithBrowserFallback(htmlUrl(n)); // null on 404
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
        html = await this.htmlWithBrowserFallback(ar5ivUrl(n)); // null on 404
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
      const bytes = await this.pdfWithBrowserFallback(pdfUrl(n)); // throws NotFoundError on 404
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
    const applyFormat = (content: string): string =>
      opts.format === "text" ? markdownToText(content) : content;

    const formattedSections: Section[] = chunk.map((s) => ({
      ...s,
      content: applyFormat(s.content),
    }));

    return {
      id: n.id,
      version: n.version,
      source: full.source,
      format: opts.format,
      title: full.title,
      abstract: full.abstract !== undefined ? applyFormat(full.abstract) : undefined,
      sections: formattedSections,
      text: formattedSections.map((s) => s.content).join("\n\n"),
      truncated: opts.truncated,
      nextCursor: opts.nextCursor,
      warnings: opts.warnings.length > 0 ? opts.warnings : undefined,
    };
  }

  // Phase 6:
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
        truncated: false,
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
        break; // adding this section would exceed the target; stop (keep >=1)
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

  // Phase 7:
  async toBibTeX(id: string): Promise<string> {
    const n = normalizeId(id);
    try {
      return await this.api.getText(bibtexUrl(n));
    } catch (fetchErr) {
      // Fallback: generate BibTeX locally from paper metadata.
      // If the local generation also fails, re-throw the *original* error
      // (e.g. RateLimitedError) so callers can distinguish network issues
      // from a mere not-found.
      try {
        const paper = await this.getPaper(id);
        return generateBibTeX(paper);
      } catch {
        throw fetchErr;
      }
    }
  }
}

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
      typeof p.charOffset !== "number" ||
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
