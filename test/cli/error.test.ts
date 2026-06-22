import { describe, it, expect } from "vitest";
import { handleCliError } from "../../src/cli/error.js";
import {
  NotFoundError,
  NetworkError,
  RateLimitedError,
  ArxivError,
} from "../../src/core/errors.js";

function sink() {
  const lines: string[] = [];
  return { lines, io: { stderr: (s: string) => { lines.push(s); } } };
}

describe("handleCliError", () => {
  it("returns correct exit code for NotFoundError (2) and emits JSON error", () => {
    const { lines, io } = sink();
    const code = handleCliError(new NotFoundError("no paper"), { json: true }, io);
    expect(code).toBe(2);
    expect(JSON.parse(lines.join(""))).toEqual({
      error: { code: "NOT_FOUND", message: "no paper" },
    });
  });

  it("returns correct exit code for RateLimitedError (3) with human message", () => {
    const { lines, io } = sink();
    const code = handleCliError(new RateLimitedError("rate limit"), {}, io);
    expect(code).toBe(3);
    expect(lines.join("")).toContain("rate limit");
  });

  it("returns correct exit code for NetworkError (4)", () => {
    const { lines, io } = sink();
    const code = handleCliError(new NetworkError("timeout"), {}, io);
    expect(code).toBe(4);
    expect(lines.join("")).toContain("timeout");
  });

  it("returns exit 1 for a plain Error with GENERIC code in JSON", () => {
    const { lines, io } = sink();
    const code = handleCliError(new Error("something went wrong"), { json: true }, io);
    expect(code).toBe(1);
    expect(JSON.parse(lines.join(""))).toEqual({
      error: { code: "GENERIC", message: "something went wrong" },
    });
  });

  it("returns exit 1 for a non-Error value", () => {
    const { lines, io } = sink();
    const code = handleCliError("oops", {}, io);
    expect(code).toBe(1);
    expect(lines.join("")).toContain("oops");
  });

  it("prints stack when verbose and err has a stack", () => {
    const { lines, io } = sink();
    const err = new ArxivError("boom");
    handleCliError(err, { verbose: true }, io);
    const out = lines.join("");
    expect(out).toContain("boom");
    expect(out).toContain("ArxivError");
  });

  it("non-JSON search usage error emits GENERIC code (not USAGE)", () => {
    // The 'provide a search query' error from buildSearchParams is a plain Error,
    // so handleCliError should emit code GENERIC, never USAGE.
    const { lines, io } = sink();
    const code = handleCliError(
      new Error("provide a search query or at least one field filter"),
      { json: true },
      io,
    );
    expect(code).toBe(1);
    const parsed = JSON.parse(lines.join(""));
    expect(parsed.error.code).toBe("GENERIC");
    expect(parsed.error.code).not.toBe("USAGE");
  });
});
