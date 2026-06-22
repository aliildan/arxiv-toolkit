import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ArxivClient } from "../core/client.js";
import type { DownloadOptions, Paper, PaperContent, ReadOptions, SearchParams, SearchResult } from "../core/types.js";
import { VERSION } from "../core/version.js";

export { VERSION };

export type ToolResult = {
  content: Array<{ type: "text"; text: string } | { type: "resource_link"; uri: string; name: string }>;
  structuredContent?: unknown;
  isError?: boolean;
};

export interface ToolRegistry {
  registerTool(
    name: string,
    config: {
      description: string;
      title?: string;
      inputSchema: Record<string, z.ZodType>;
      outputSchema?: Record<string, z.ZodType>;
    },
    handler: (args: Record<string, unknown>) => Promise<ToolResult>,
  ): unknown;
}

export interface SearchArgs {
  query?: string;
  author?: string;
  category?: string;
  title?: string;
  abstract?: string;
  sortBy?: "relevance" | "submittedDate" | "lastUpdatedDate";
  sortOrder?: "ascending" | "descending";
  maxResults?: number;
  start?: number;
}

export interface RecentArgs {
  category: string;
  maxResults?: number;
}

export interface MetadataArgs {
  ids: string[];
  bibtex?: boolean;
}

export interface ReadArgs {
  id: string;
  source?: "auto" | "html" | "pdf";
  format?: "markdown" | "text";
  section?: string;
  maxChars?: number;
  cursor?: string;
}

export interface DownloadArgs {
  id: string;
  dest?: string;
}

// --- Shared zod shapes ---

const authorShape = { name: z.string(), affiliation: z.string().optional() };
const linksShape = { abs: z.string(), pdf: z.string(), html: z.string().optional() };

export const paperShape = {
  id: z.string(),
  version: z.number().optional(),
  idWithVersion: z.string().optional(),
  title: z.string(),
  summary: z.string(),
  authors: z.array(z.object(authorShape)),
  categories: z.array(z.string()),
  primaryCategory: z.string(),
  published: z.string(),
  updated: z.string(),
  doi: z.string().optional(),
  journalRef: z.string().optional(),
  comment: z.string().optional(),
  links: z.object(linksShape),
};

export const searchResultShape = {
  total: z.number(),
  start: z.number(),
  count: z.number(),
  papers: z.array(z.object(paperShape)),
  hints: z.array(z.string()).optional(),
};

export const metadataShape = {
  papers: z.array(z.object(paperShape)),
  bibtex: z.array(z.string()).optional(),
};

const sectionShape = {
  id: z.string().optional(),
  title: z.string(),
  level: z.number(),
  content: z.string(),
};

export const contentShape = {
  id: z.string(),
  version: z.number().optional(),
  source: z.enum(["html-native", "html-ar5iv", "pdf"]),
  format: z.enum(["markdown", "text"]),
  title: z.string(),
  abstract: z.string().optional(),
  sections: z.array(z.object(sectionShape)),
  text: z.string(),
  truncated: z.boolean(),
  nextCursor: z.string().optional(),
  warnings: z.array(z.string()).optional(),
};

export const downloadShape = {
  path: z.string(),
  bytes: z.number(),
};

// --- Error helper ---

function errorResult(err: unknown): ToolResult {
  const msg = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
}

// --- Text formatters ---

function formatSearchText(r: SearchResult): string {
  const lines = [`Found ${r.total} results (showing ${r.start + 1}-${r.start + r.count})`];
  for (const p of r.papers) lines.push(`- ${p.id} — ${p.title}`);
  if (r.hints && r.hints.length) lines.push("", ...r.hints);
  return lines.join("\n");
}

// --- Handlers ---

export async function searchHandler(client: ArxivClient, args: SearchArgs): Promise<ToolResult> {
  try {
    const params: SearchParams = {};
    if (args.query !== undefined) params.query = args.query;
    if (args.author !== undefined) params.author = args.author;
    if (args.category !== undefined) params.category = args.category;
    if (args.title !== undefined) params.title = args.title;
    if (args.abstract !== undefined) params.abstract = args.abstract;
    if (args.sortBy !== undefined) params.sortBy = args.sortBy;
    if (args.sortOrder !== undefined) params.sortOrder = args.sortOrder;
    if (args.maxResults !== undefined) params.maxResults = args.maxResults;
    if (args.start !== undefined) params.start = args.start;
    const result = await client.search(params);
    return { content: [{ type: "text", text: formatSearchText(result) }], structuredContent: result };
  } catch (err) {
    return errorResult(err);
  }
}

export async function recentHandler(client: ArxivClient, args: RecentArgs): Promise<ToolResult> {
  try {
    const result = await client.recent(args.category, { maxResults: args.maxResults });
    return { content: [{ type: "text", text: formatSearchText(result) }], structuredContent: result };
  } catch (err) {
    return errorResult(err);
  }
}

export async function metadataHandler(client: ArxivClient, args: MetadataArgs): Promise<ToolResult> {
  try {
    const papers: Paper[] = await client.getPapers(args.ids);
    const structured: { papers: Paper[]; bibtex?: string[] } = { papers };
    let text = `Metadata for ${papers.length} paper(s)\n` + papers.map((p) => `- ${p.id} — ${p.title}`).join("\n");
    if (args.bibtex) {
      structured.bibtex = await Promise.all(papers.map((p) => client.toBibTeX(p.id)));
      text += `\n\nBibTeX:\n${structured.bibtex.join("\n\n")}`;
    }
    return { content: [{ type: "text", text }], structuredContent: structured };
  } catch (err) {
    return errorResult(err);
  }
}

export async function readHandler(client: ArxivClient, args: ReadArgs): Promise<ToolResult> {
  try {
    const opts: ReadOptions = {};
    if (args.source !== undefined) opts.source = args.source;
    if (args.format !== undefined) opts.format = args.format;
    if (args.section !== undefined) opts.section = args.section;
    if (args.maxChars !== undefined) opts.maxChars = args.maxChars;
    if (args.cursor !== undefined) opts.cursor = args.cursor;
    const content: PaperContent = await client.getContent(args.id, opts);
    const text = `# ${content.title}\n\n${content.text}`;
    return { content: [{ type: "text", text }], structuredContent: content };
  } catch (err) {
    return errorResult(err);
  }
}

export async function downloadHandler(client: ArxivClient, args: DownloadArgs): Promise<ToolResult> {
  try {
    const opts: DownloadOptions = {};
    if (args.dest !== undefined) opts.dir = args.dest;
    const { path, bytes } = await client.download(args.id, opts);
    const name = path.split("/").pop() ?? path;
    return {
      content: [
        { type: "text", text: `Saved ${path} (${bytes} bytes)` },
        { type: "resource_link", uri: `file://${path}`, name },
      ],
      structuredContent: { path, bytes },
    };
  } catch (err) {
    return errorResult(err);
  }
}

// --- Tool registration ---

export function registerTools(server: ToolRegistry, client: ArxivClient): void {
  server.registerTool(
    "arxiv_search",
    {
      description: "Search arXiv papers by free-text query and/or field filters (title, author, abstract, category).",
      inputSchema: {
        query: z.string().optional(),
        author: z.string().optional(),
        category: z.string().optional(),
        title: z.string().optional(),
        abstract: z.string().optional(),
        sortBy: z.enum(["relevance", "submittedDate", "lastUpdatedDate"]).optional(),
        sortOrder: z.enum(["ascending", "descending"]).optional(),
        maxResults: z.number().int().optional(),
        start: z.number().int().optional(),
      },
      outputSchema: searchResultShape,
    },
    async (args) => searchHandler(client, args as unknown as SearchArgs),
  );

  server.registerTool(
    "arxiv_list_recent",
    {
      description: "List the most recent arXiv papers in a category (sorted by submission date, newest first).",
      inputSchema: {
        category: z.string(),
        maxResults: z.number().int().optional(),
      },
      outputSchema: searchResultShape,
    },
    async (args) => recentHandler(client, args as unknown as RecentArgs),
  );

  server.registerTool(
    "arxiv_get_metadata",
    {
      description: "Fetch metadata for one or more arXiv IDs, optionally including BibTeX for each ID.",
      inputSchema: {
        ids: z.array(z.string()).min(1),
        bibtex: z.boolean().optional(),
      },
      outputSchema: metadataShape,
    },
    async (args) => metadataHandler(client, args as unknown as MetadataArgs),
  );

  server.registerTool(
    "arxiv_read_paper",
    {
      description: "Read the full text of an arXiv paper as section-aware Markdown or plain text, with chunking via maxChars/cursor.",
      inputSchema: {
        id: z.string(),
        source: z.enum(["auto", "html", "pdf"]).optional(),
        format: z.enum(["markdown", "text"]).optional(),
        section: z.string().optional(),
        maxChars: z.number().int().optional(),
        cursor: z.string().optional(),
      },
      outputSchema: contentShape,
    },
    async (args) => readHandler(client, args as unknown as ReadArgs),
  );

  server.registerTool(
    "arxiv_download",
    {
      description: "Download a paper's PDF to a local directory and return the absolute path plus a file:// resource link.",
      inputSchema: {
        id: z.string(),
        dest: z.string().optional(),
      },
      outputSchema: downloadShape,
    },
    async (args) => downloadHandler(client, args as unknown as DownloadArgs),
  );
}

export function buildServer(client: ArxivClient): McpServer {
  const server = new McpServer({ name: "arxiv", version: VERSION });
  registerTools(server as unknown as ToolRegistry, client);
  return server;
}
