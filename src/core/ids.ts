import type { NormalizedId } from "./types.js";
import { ParseError } from "./errors.js";

const NEW_ID = /^\d{4}\.\d{4,5}$/;
const OLD_ID = /^[a-z-]+(\.[A-Z]{2})?\/\d{7}$/;
const VERSION = /^v(\d+)$/;

// Matches an optional leading URL/host/path-prefix that we strip before parsing
// the bare id. Captures the tail that should contain the id (+ optional version).
const PREFIX = /^(?:https?:\/\/)?(?:[^/]+\/)?(?:abs|html|pdf|bibtex)\//i;

interface Parsed {
  id: string;
  version?: number;
}

function parseBare(raw: string): Parsed {
  // Strip a trailing .pdf (only meaningful for /pdf/ URLs, harmless otherwise).
  let s = raw.replace(/\.pdf$/i, "");
  // Strip an optional version suffix to inspect the core id.
  let version: number | undefined;
  const vMatch = s.match(/^(.*)v(\d+)$/);
  let core: string;
  if (vMatch) {
    core = vMatch[1];
    version = Number(vMatch[2]);
  } else {
    core = s;
  }
  if (!NEW_ID.test(core) && !OLD_ID.test(core)) {
    throw new ParseError(`Invalid arXiv id: ${raw}`);
  }
  return { id: core, version };
}

/**
 * Normalize an arXiv identifier from any accepted input form (bare id,
 * abs/html/pdf/bibtex URL, or ar5iv URL) into a canonical NormalizedId.
 * The old-style slash is preserved verbatim in `id` and in all URLs.
 */
export function normalizeId(input: string): NormalizedId {
  if (typeof input !== "string") {
    throw new ParseError(`Invalid arXiv id: ${String(input)}`);
  }
  let s = input.trim();
  if (s.length === 0) {
    throw new ParseError("Invalid arXiv id: empty input");
  }
  // Lowercase the scheme/host so hostname matching is case-insensitive,
  // but DO NOT lowercase the id tail (old-style subject classes are case-significant).
  const schemeHostEnd = s.indexOf("://");
  if (schemeHostEnd !== -1) {
    const hostEnd = s.indexOf("/", schemeHostEnd + 3);
    if (hostEnd !== -1) {
      // Lowercase scheme+host, preserve path verbatim (keeps subject class case).
      s = s.slice(0, hostEnd).toLowerCase() + s.slice(hostEnd);
    } else {
      s = s.toLowerCase();
    }
  }
  s = s.replace(PREFIX, "");
  const parsed = parseBare(s);
  const n: NormalizedId = { id: parsed.id };
  if (parsed.version !== undefined) {
    n.version = parsed.version;
    n.idWithVersion = `${parsed.id}v${parsed.version}`;
  }
  return n;
}

function withVersion(n: NormalizedId): string {
  return n.idWithVersion ?? n.id;
}

export function absUrl(n: NormalizedId): string {
  return `https://arxiv.org/abs/${withVersion(n)}`;
}

export function htmlUrl(n: NormalizedId): string {
  return `https://arxiv.org/html/${withVersion(n)}`;
}

export function ar5ivUrl(n: NormalizedId): string {
  return `https://ar5iv.labs.arxiv.org/html/${withVersion(n)}`;
}

export function pdfUrl(n: NormalizedId): string {
  return `https://arxiv.org/pdf/${withVersion(n)}.pdf`;
}

export function bibtexUrl(n: NormalizedId): string {
  return `https://arxiv.org/bibtex/${withVersion(n)}`;
}

/**
 * On-disk filename: the id slash (old-style) is replaced with `_`;
 * a known version is appended as `v{n}`; always ends in `.pdf`.
 */
export function filenameFor(n: NormalizedId): string {
  const base = withVersion(n).replace("/", "_");
  return `${base}.pdf`;
}
