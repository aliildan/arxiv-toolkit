import { describe, it, expect } from "vitest";
import {
  existsSync,
  readFileSync,
  symlinkSync,
  rmSync,
  mkdtempSync,
} from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const repoRoot = resolve(__dirname, "..", "..");
const distDir = resolve(repoRoot, "dist");

describe("build output", () => {
  it(
    "npm run build succeeds",
    () => {
      execSync("npm run build", { cwd: repoRoot, stdio: "pipe" });
    },
    120000,
  );

  it("emits dist/index.js, dist/cli.js, dist/mcp.js", () => {
    expect(existsSync(resolve(distDir, "index.js"))).toBe(true);
    expect(existsSync(resolve(distDir, "cli.js"))).toBe(true);
    expect(existsSync(resolve(distDir, "mcp.js"))).toBe(true);
  });

  it("emits dist/index.d.ts for the library", () => {
    expect(existsSync(resolve(distDir, "index.d.ts"))).toBe(true);
  });

  const SHEBANG = "#!/usr/bin/env node";

  it("cli.js has the node shebang", () => {
    const head = readFileSync(resolve(distDir, "cli.js"), "utf8").slice(
      0,
      SHEBANG.length,
    );
    expect(head).toBe(SHEBANG);
  });

  it("mcp.js has the node shebang", () => {
    const head = readFileSync(resolve(distDir, "mcp.js"), "utf8").slice(
      0,
      SHEBANG.length,
    );
    expect(head).toBe(SHEBANG);
  });

  it("index.js does NOT have a shebang (library chunk stays clean/importable)", () => {
    const head = readFileSync(resolve(distDir, "index.js"), "utf8").slice(
      0,
      SHEBANG.length,
    );
    expect(head).not.toBe(SHEBANG);
  });

  it(
    "dist/index.js exports ArxivClient and normalizeId as named exports",
    async () => {
      const distIndexUrl = pathToFileURL(resolve(distDir, "index.js")).href;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mod = await import(distIndexUrl) as Record<string, unknown>;
      expect(typeof mod.ArxivClient).toBe("function");
      expect(typeof mod.normalizeId).toBe("function");
    },
    30000,
  );

  // Regression: an npm-installed bin runs via a SYMLINK, so the entry-point
  // guard must compare resolved real paths (not raw argv[1]). A naive
  // `import.meta.url === file://${process.argv[1]}` makes the bin a silent
  // no-op when invoked through the symlink (the real global-install case).
  it(
    "cli.js runs and prints the real version when invoked via a symlink",
    () => {
      const expected = (
        JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8")) as {
          version: string;
        }
      ).version;
      const dir = mkdtempSync(join(tmpdir(), "arxiv-bin-"));
      const link = join(dir, "arxiv");
      symlinkSync(resolve(distDir, "cli.js"), link);
      try {
        const out = execSync(`node ${link} --version`, {
          encoding: "utf8",
        }).trim();
        expect(out).toBe(expected); // not empty, and not the "0.0.0" fallback
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    30000,
  );
});
