import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

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
});
