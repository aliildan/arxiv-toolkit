import { ArxivError, exitCodeFor } from "../core/errors.js";

export interface ErrorIo {
  stderr(s: string): void;
}

export interface ErrorOpts {
  json?: boolean;
  verbose?: boolean;
}

/**
 * Shared CLI error handler.
 * Returns the exit code for the caller to use.
 */
export function handleCliError(
  err: unknown,
  opts: ErrorOpts,
  io: ErrorIo,
): number {
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
