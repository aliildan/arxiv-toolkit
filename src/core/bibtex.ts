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
