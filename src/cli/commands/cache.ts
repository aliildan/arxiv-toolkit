import { rm } from "node:fs/promises";
import { resolveConfig } from "../../core/config.js";

export type CacheAction = "clear" | "path";

export interface CacheFlags {
  cacheDir?: string;
}

export interface CacheIo {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
}

export async function runCache(
  action: CacheAction,
  opts: CacheFlags,
  io: CacheIo,
): Promise<number> {
  // Resolve config only to discover cacheDir; a cacheDir override in flags wins.
  const cfg = resolveConfig(opts.cacheDir ? { cacheDir: opts.cacheDir } : undefined);
  const cacheDir = cfg.cacheDir;

  if (action === "path") {
    io.stdout(cacheDir + "\n");
    return 0;
  }

  if (action === "clear") {
    try {
      await rm(cacheDir, { recursive: true, force: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      io.stderr(`Error clearing cache: ${msg}\n`);
      return 1;
    }
    io.stdout(`Cache cleared: ${cacheDir}\n`);
    return 0;
  }

  io.stderr(`Unknown cache action: ${String(action)}. Use 'clear' or 'path'.\n`);
  return 1;
}
