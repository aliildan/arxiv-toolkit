import type { ArxivClient } from "../../core/client.js";
import type { DownloadOptions } from "../../core/types.js";
import { ArxivError, exitCodeFor } from "../../core/errors.js";

export interface DownloadFlags {
  out?: string;
  json?: boolean;
  quiet?: boolean;
  verbose?: boolean;
}

export interface DownloadIo {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
}

export async function runDownload(
  client: ArxivClient,
  ids: string[],
  opts: DownloadFlags,
  io: DownloadIo,
): Promise<number> {
  let firstFailureCode: number | null = null;

  for (const id of ids) {
    const dlOpts: DownloadOptions = {};
    if (opts.out) dlOpts.dir = opts.out;

    try {
      const { path, bytes } = await client.download(id, dlOpts);
      if (opts.json) {
        io.stdout(JSON.stringify({ id, path, bytes }) + "\n");
      } else {
        io.stdout(path + "\n");
      }
    } catch (err) {
      const code = err instanceof ArxivError ? exitCodeFor(err) : 1;
      if (firstFailureCode === null) firstFailureCode = code;

      if (opts.json) {
        const errCode = err instanceof ArxivError ? err.code : "GENERIC";
        const errMsg = err instanceof Error ? err.message : String(err);
        io.stderr(
          JSON.stringify({ error: { id, code: errCode, message: errMsg } }) + "\n",
        );
      } else {
        const errMsg = err instanceof Error ? err.message : String(err);
        io.stderr(`Error downloading ${id}: ${errMsg}\n`);
        if (opts.verbose && err instanceof Error && err.stack) {
          io.stderr(err.stack + "\n");
        }
      }
    }
  }

  return firstFailureCode ?? 0;
}
