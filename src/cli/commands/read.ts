import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ArxivClient } from "../../core/client.js";
import type { PaperContent, ReadOptions } from "../../core/types.js";
import { ArxivError, exitCodeFor } from "../../core/errors.js";

export interface ReadFlags {
  source?: "auto" | "html" | "pdf";
  format?: "markdown" | "text";
  section?: string;
  maxChars?: number;
  out?: string;
  json?: boolean;
  quiet?: boolean;
  verbose?: boolean;
}

export interface ReadIo {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
}

export function buildReadOptions(opts: ReadFlags): ReadOptions {
  const o: ReadOptions = {};
  // Only pass source/format if they diverge from the ArxivClient's own defaults
  // ("auto" and "markdown" are the client's natural defaults — omitting them is
  // equivalent, and it keeps the opts object empty when the user didn't specify).
  if (opts.source !== undefined && opts.source !== "auto") o.source = opts.source;
  if (opts.format !== undefined && opts.format !== "markdown") o.format = opts.format;
  if (opts.section !== undefined) o.section = opts.section;
  if (opts.maxChars !== undefined) o.maxChars = opts.maxChars;
  return o;
}

export function formatReadJson(content: PaperContent): string {
  return JSON.stringify(content, null, 2);
}

export async function runRead(
  client: ArxivClient,
  id: string,
  opts: ReadFlags,
  io: ReadIo,
): Promise<number> {
  try {
    const readOpts = buildReadOptions(opts);
    const content = await client.getContent(id, readOpts);

    if (!opts.quiet && content.warnings) {
      for (const w of content.warnings) io.stderr(`Warning: ${w}\n`);
    }

    if (opts.out) {
      // --out ALWAYS writes the formatted content file, regardless of --json.
      const absPath = resolve(opts.out);
      await writeFile(absPath, content.text, "utf8");
      if (opts.json) {
        // JSON mode + --out: emit envelope with path so callers know where the
        // file landed, plus nextCursor/warnings for paging awareness.
        const envelope: Record<string, unknown> = {
          path: absPath,
          truncated: content.truncated,
        };
        if (content.nextCursor !== undefined) envelope.nextCursor = content.nextCursor;
        if (content.warnings !== undefined) envelope.warnings = content.warnings;
        io.stdout(JSON.stringify(envelope, null, 2) + "\n");
      } else {
        io.stdout(`Saved to ${absPath}\n`);
        if (content.nextCursor) {
          io.stderr(`nextCursor: ${content.nextCursor}\n`);
        }
      }
    } else if (opts.json) {
      io.stdout(formatReadJson(content) + "\n");
    } else {
      io.stdout(content.text);
      if (content.nextCursor) {
        io.stderr(`nextCursor: ${content.nextCursor}\n`);
      }
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
