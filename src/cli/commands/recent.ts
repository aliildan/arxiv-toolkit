import type { ArxivClient } from "../../core/client.js";
import type { SearchResult } from "../../core/types.js";
import { ArxivError, exitCodeFor } from "../../core/errors.js";

export interface RecentFlags {
  max?: number;
  json?: boolean;
  quiet?: boolean;
  verbose?: boolean;
}

export interface RecentIo {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
}

function formatAuthors(authors: SearchResult["papers"][number]["authors"]): string {
  if (authors.length === 0) return "Unknown";
  if (authors.length <= 3) return authors.map((a) => a.name).join(", ");
  return `${authors[0].name} et al.`;
}

export function formatRecentJson(result: SearchResult): string {
  return JSON.stringify(result, null, 2);
}

export function formatRecentHuman(result: SearchResult): string {
  const lines: string[] = [];
  lines.push(
    `Found ${result.total} result(s) (showing ${result.start + 1}-${result.start + result.count})`,
  );
  lines.push("");
  result.papers.forEach((p, i) => {
    lines.push(`${i + 1}. ${p.title}`);
    lines.push(
      `   ${p.id} | ${formatAuthors(p.authors)} | ${p.primaryCategory} | ${p.published.slice(0, 10)}`,
    );
  });
  return lines.join("\n") + "\n";
}

export async function runRecent(
  client: ArxivClient,
  category: string,
  opts: RecentFlags,
  io: RecentIo,
): Promise<number> {
  try {
    const recentOpts: { maxResults?: number } = {};
    if (opts.max !== undefined) recentOpts.maxResults = opts.max;
    const result = await client.recent(category, recentOpts);
    if (opts.json) {
      io.stdout(formatRecentJson(result) + "\n");
    } else {
      io.stdout(formatRecentHuman(result));
    }
    if (!opts.quiet && result.hints) {
      for (const h of result.hints) io.stderr(h + "\n");
    }
    return 0;
  } catch (err) {
    if (err instanceof ArxivError) {
      const code = exitCodeFor(err);
      if (opts.json) {
        io.stderr(
          JSON.stringify({ error: { code: err.code, message: err.message } }) + "\n",
        );
      } else {
        io.stderr(`Error: ${err.message}\n`);
        if (opts.verbose && err.stack) io.stderr(err.stack + "\n");
      }
      return code;
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (opts.json) {
      io.stderr(JSON.stringify({ error: { code: "GENERIC", message: msg } }) + "\n");
    } else {
      io.stderr(`Error: ${msg}\n`);
    }
    return 1;
  }
}
