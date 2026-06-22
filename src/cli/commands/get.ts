import type { ArxivClient } from "../../core/client.js";
import type { Paper } from "../../core/types.js";
import { normalizeId } from "../../core/ids.js";
import { handleCliError } from "../error.js";

export interface GetFlags {
  bibtex?: boolean;
  json?: boolean;
  quiet?: boolean;
  verbose?: boolean;
}

export interface GetIo {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
}

function formatAuthors(authors: Paper["authors"]): string {
  if (authors.length === 0) return "Unknown";
  if (authors.length <= 3) return authors.map((a) => a.name).join(", ");
  return `${authors[0].name} et al.`;
}

export function formatGetJson(papers: Paper[], bibtex?: Map<string, string>): string {
  const result = {
    papers: papers.map((p) => {
      if (bibtex && bibtex.has(p.id)) {
        return { ...p, bibtex: bibtex.get(p.id) };
      }
      return p;
    }),
  };
  return JSON.stringify(result, null, 2);
}

export function formatGetHuman(papers: Paper[], bibtex?: Map<string, string>): string {
  const lines: string[] = [];
  for (const p of papers) {
    lines.push(`${p.title}`);
    lines.push(`  ID:         ${p.idWithVersion ?? p.id}`);
    lines.push(`  Authors:    ${formatAuthors(p.authors)}`);
    lines.push(`  Category:   ${p.primaryCategory}`);
    lines.push(`  Published:  ${p.published.slice(0, 10)}`);
    if (p.doi) lines.push(`  DOI:        ${p.doi}`);
    lines.push(`  Abstract:   ${p.summary.slice(0, 200)}${p.summary.length > 200 ? "…" : ""}`);
    if (bibtex && bibtex.has(p.id)) {
      lines.push("");
      lines.push(bibtex.get(p.id)!);
    }
    lines.push("");
  }
  return lines.join("\n");
}

export async function runGet(
  client: ArxivClient,
  ids: string[],
  opts: GetFlags,
  io: GetIo,
): Promise<number> {
  try {
    const papers = await client.getPapers(ids);
    let bibtex: Map<string, string> | undefined;
    if (opts.bibtex) {
      bibtex = new Map<string, string>();
      await Promise.all(
        ids.map(async (id) => {
          try {
            const bib = await (client as ArxivClient).toBibTeX(id);
            bibtex!.set(normalizeId(id).id, bib);
          } catch {
            // best-effort; do not fail the whole command if one bibtex fetch fails
          }
        }),
      );
    }
    if (opts.json) {
      io.stdout(formatGetJson(papers, bibtex) + "\n");
    } else {
      io.stdout(formatGetHuman(papers, bibtex));
    }
    return 0;
  } catch (err) {
    return handleCliError(err, opts, io);
  }
}
