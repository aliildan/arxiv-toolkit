import type { ArxivClient } from "../../core/client.js";
import type { SearchParams, SearchResult } from "../../core/types.js";
import { handleCliError } from "../error.js";

export interface SearchFlags {
  author?: string;
  category?: string;
  title?: string;
  abstract?: string;
  sort?: "relevance" | "submitted" | "updated";
  order?: "asc" | "desc";
  max?: number;
  start?: number;
  json?: boolean;
  quiet?: boolean;
  verbose?: boolean;
}

export interface SearchIo {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
}

function mapSort(sort: SearchFlags["sort"]): SearchParams["sortBy"] {
  if (sort === "submitted") return "submittedDate";
  if (sort === "updated") return "lastUpdatedDate";
  return "relevance";
}

function mapOrder(order: SearchFlags["order"]): SearchParams["sortOrder"] {
  return order === "asc" ? "ascending" : "descending";
}

export function buildSearchParams(query: string | undefined, opts: SearchFlags): SearchParams {
  const params: SearchParams = {};
  if (query) params.query = query;
  if (opts.author) params.author = opts.author;
  if (opts.category) params.category = opts.category;
  if (opts.title) params.title = opts.title;
  if (opts.abstract) params.abstract = opts.abstract;
  if (opts.sort) params.sortBy = mapSort(opts.sort);
  if (opts.order) params.sortOrder = mapOrder(opts.order);
  if (opts.max !== undefined) params.maxResults = opts.max;
  if (opts.start !== undefined) params.start = opts.start;
  if (!params.query && !params.author && !params.title && !params.abstract && !params.category) {
    throw new Error(
      "provide a search query or at least one field filter (--title, --author, --abstract, --category)",
    );
  }
  return params;
}

function formatAuthors(p: SearchResult["papers"][number]): string {
  const a = p.authors;
  if (a.length === 0) return "Unknown";
  if (a.length <= 3) return a.map((x) => x.name).join(", ");
  return `${a[0].name} et al.`;
}

export function formatSearchJson(result: SearchResult): string {
  return JSON.stringify(result, null, 2);
}

export function formatSearchHuman(result: SearchResult): string {
  const lines: string[] = [];
  lines.push(`Found ${result.total} result(s) (showing ${result.start + 1}-${result.start + result.count})`);
  lines.push("");
  result.papers.forEach((p, i) => {
    lines.push(`${i + 1}. ${p.title}`);
    lines.push(`   ${p.id} | ${formatAuthors(p)} | ${p.primaryCategory} | ${p.published.slice(0, 10)}`);
  });
  return lines.join("\n") + "\n";
}

export async function runSearch(
  client: ArxivClient,
  query: string | undefined,
  opts: SearchFlags,
  io: SearchIo,
): Promise<number> {
  try {
    const params = buildSearchParams(query, opts);
    const result = await client.search(params);
    if (opts.json) {
      io.stdout(formatSearchJson(result) + "\n");
    } else {
      io.stdout(formatSearchHuman(result));
    }
    if (!opts.quiet && result.hints) {
      for (const h of result.hints) io.stderr(h + "\n");
    }
    return 0;
  } catch (err) {
    return handleCliError(err, opts, io);
  }
}
