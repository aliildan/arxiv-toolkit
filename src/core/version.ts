import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

function readVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "..", "package.json"), // bundled flat dist/ -> package root
    join(here, "..", "..", "package.json"), // src/<dir>/ -> repo root (dev/vitest)
    join(here, "..", "..", "..", "package.json"),
  ];
  for (const p of candidates) {
    try {
      const pkg = require(p) as { version: string };
      if (typeof pkg.version === "string" && pkg.version.length > 0) {
        return pkg.version;
      }
    } catch {
      // try next candidate
    }
  }
  return "0.0.0";
}

export const VERSION: string = readVersion();
