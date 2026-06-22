import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildReadOptions,
  formatReadJson,
  runRead,
} from "../../../src/cli/commands/read.js";
import type { ArxivClient } from "../../../src/core/client.js";
import type { PaperContent } from "../../../src/core/types.js";
import { NotFoundError, UnsupportedError } from "../../../src/core/errors.js";

const content: PaperContent = {
  id: "1706.03762",
  version: 1,
  source: "html-native",
  format: "markdown",
  title: "Attention Is All You Need",
  abstract: "We propose a new network architecture...",
  sections: [
    { id: "S1", title: "Introduction", level: 1, content: "## Introduction\n\nWe propose..." },
  ],
  text: "## Introduction\n\nWe propose...",
  truncated: false,
};

const contentWithCursor: PaperContent = {
  ...content,
  truncated: true,
  nextCursor: "eyJpZCI6IjE3MDYuMDM3NjIiLCJzZWN0aW9uSW5kZXgiOjF9",
};

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
beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), "arxiv-read-")); });
afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

describe("buildReadOptions", () => {
  it("maps all flags to ReadOptions", () => {
    const opts = buildReadOptions({
      source: "html",
      format: "text",
      section: "Introduction",
      maxChars: 5000,
    });
    expect(opts).toEqual({
      source: "html",
      format: "text",
      section: "Introduction",
      maxChars: 5000,
    });
  });

  it("omits undefined fields (uses client defaults)", () => {
    const opts = buildReadOptions({});
    expect(opts).toEqual({});
  });
});

describe("formatReadJson", () => {
  it("serializes content including nextCursor when present", () => {
    const parsed = JSON.parse(formatReadJson(contentWithCursor));
    expect(parsed.id).toBe("1706.03762");
    expect(parsed.nextCursor).toBe(contentWithCursor.nextCursor);
    expect(parsed.truncated).toBe(true);
  });

  it("does not include nextCursor key when absent", () => {
    const parsed = JSON.parse(formatReadJson(content));
    expect("nextCursor" in parsed).toBe(false);
  });
});

describe("runRead", () => {
  it("calls client.getContent with mapped options and prints text to stdout", async () => {
    const client = {
      getContent: vi.fn().mockResolvedValue(content),
    } as unknown as ArxivClient;
    const { out, err, io } = sink();
    const code = await runRead(client, "1706.03762", {}, io);
    expect(code).toBe(0);
    expect(client.getContent).toHaveBeenCalledWith("1706.03762", {});
    expect(out.join("")).toContain("## Introduction");
    expect(err).toEqual([]);
  });

  it("emits JSON envelope in --json mode", async () => {
    const client = {
      getContent: vi.fn().mockResolvedValue(content),
    } as unknown as ArxivClient;
    const { out, io } = sink();
    const code = await runRead(client, "1706.03762", { json: true }, io);
    expect(code).toBe(0);
    const parsed = JSON.parse(out.join(""));
    expect(parsed.id).toBe("1706.03762");
    expect(parsed.source).toBe("html-native");
  });

  it("prints nextCursor to stderr in human mode and includes in JSON", async () => {
    const client = {
      getContent: vi.fn().mockResolvedValue(contentWithCursor),
    } as unknown as ArxivClient;
    // human mode: nextCursor to stderr
    const h = sink();
    await runRead(client, "1706.03762", {}, h.io);
    expect(h.err.join("")).toContain(contentWithCursor.nextCursor);

    // json mode: nextCursor in envelope
    const j = sink();
    await runRead(client, "1706.03762", { json: true }, j.io);
    const parsed = JSON.parse(j.out.join(""));
    expect(parsed.nextCursor).toBe(contentWithCursor.nextCursor);
    expect(j.err.join("")).not.toContain(contentWithCursor.nextCursor);
  });

  it("prints warnings to stderr unless --quiet", async () => {
    const withWarnings: PaperContent = { ...content, warnings: ["ar5iv fallback used"] };
    const client = {
      getContent: vi.fn().mockResolvedValue(withWarnings),
    } as unknown as ArxivClient;
    const loud = sink();
    await runRead(client, "1706.03762", {}, loud.io);
    expect(loud.err.join("")).toContain("ar5iv fallback used");

    const quiet = sink();
    await runRead(client, "1706.03762", { quiet: true }, quiet.io);
    expect(quiet.err.join("")).toBe("");
  });

  it("writes text to --out file and prints absolute path to stdout", async () => {
    const client = {
      getContent: vi.fn().mockResolvedValue(content),
    } as unknown as ArxivClient;
    const outFile = join(tmpDir, "paper.md");
    const { out, io } = sink();
    const code = await runRead(client, "1706.03762", { out: outFile }, io);
    expect(code).toBe(0);
    expect(out.join("")).toContain(outFile);
    const written = await readFile(outFile, "utf8");
    expect(written).toContain("## Introduction");
  });

  it("maps NotFoundError to exit 2 with JSON error envelope when --json", async () => {
    const client = {
      getContent: vi.fn().mockRejectedValue(new NotFoundError("paper not found")),
    } as unknown as ArxivClient;
    const { err, io } = sink();
    const code = await runRead(client, "9999.99999", { json: true }, io);
    expect(code).toBe(2);
    expect(JSON.parse(err.join(""))).toEqual({
      error: { code: "NOT_FOUND", message: "paper not found" },
    });
  });

  it("maps UnsupportedError to exit 6", async () => {
    const client = {
      getContent: vi.fn().mockRejectedValue(new UnsupportedError("no browser")),
    } as unknown as ArxivClient;
    const { io } = sink();
    const code = await runRead(client, "1706.03762", {}, io);
    expect(code).toBe(6);
  });
});
