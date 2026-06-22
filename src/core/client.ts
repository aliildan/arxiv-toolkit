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

  // Phase 6:
  async getContent(id: string, opts?: ReadOptions): Promise<PaperContent> { throw new Error("getContent: implemented in Phase 6"); }
  async download(id: string, opts?: DownloadOptions): Promise<{ path: string; bytes: number }> { throw new Error("download: implemented in Phase 6"); }

  // Phase 7:
  async toBibTeX(id: string): Promise<string> { throw new Error("toBibTeX: implemented in Phase 7"); }
}
