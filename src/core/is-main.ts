import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * True when the module with the given `import.meta.url` is the process entry
 * point. Robust to npm bin symlinks: a globally/npx-installed bin runs via a
 * symlink, so `process.argv[1]` is the symlink path while `import.meta.url`
 * resolves to the real file — comparing the two raw strings (as
 * ``import.meta.url === `file://${process.argv[1]}` ``) wrongly reports false
 * and the bin silently does nothing. Resolve both to real paths and compare.
 */
export function isEntrypoint(importMetaUrl: string): boolean {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  try {
    return realpathSync(argv1) === fileURLToPath(importMetaUrl);
  } catch {
    return false;
  }
}
