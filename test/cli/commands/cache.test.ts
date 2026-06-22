import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runCache } from "../../../src/cli/commands/cache.js";

function sink() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: {
      stdout: (s: string) => { out.push(s); },
      stderr: (s: string) => { err.push(s); },
    },
  };
}

let tmpDir: string;
beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "arxiv-cache-cmd-"));
});
afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("runCache path", () => {
  it("prints the cache directory path to stdout", async () => {
    const { out, io } = sink();
    const code = await runCache("path", { cacheDir: tmpDir }, io);
    expect(code).toBe(0);
    expect(out.join("").trim()).toBe(tmpDir);
  });
});

describe("runCache clear", () => {
  it("removes all files in the cache directory and returns 0", async () => {
    // populate the cache dir with some files
    const subDir = join(tmpDir, "entries");
    mkdirSync(subDir);
    writeFileSync(join(subDir, "abc.json"), "{}");
    writeFileSync(join(tmpDir, "xyz.json"), "{}");

    const { out, io } = sink();
    const code = await runCache("clear", { cacheDir: tmpDir }, io);
    expect(code).toBe(0);
    // the cache dir itself should no longer exist (rm recursive) or be empty;
    // either is acceptable — the spec just says "empties it"
    expect(existsSync(join(subDir, "abc.json"))).toBe(false);
    expect(out.join("")).toContain(tmpDir);
  });

  it("returns 0 when the cache directory does not exist (no error)", async () => {
    const nonExistent = join(tmpDir, "does-not-exist");
    const { io } = sink();
    const code = await runCache("clear", { cacheDir: nonExistent }, io);
    expect(code).toBe(0);
  });

  it("returns 1 and writes to stderr when an unknown action is provided", async () => {
    const { err, io } = sink();
    // @ts-expect-error intentional bad action for test
    const code = await runCache("bogus", { cacheDir: tmpDir }, io);
    expect(code).toBe(1);
    expect(err.join("")).toContain("bogus");
  });
});
