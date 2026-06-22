import { describe, it, expect } from "vitest";
import {
  ArxivError,
  NotFoundError,
  RateLimitedError,
  NetworkError,
  ParseError,
  UnsupportedError,
  exitCodeFor,
} from "../../src/core/errors.js";

describe("error class hierarchy", () => {
  it("NotFoundError is an instanceof ArxivError", () => {
    const err = new NotFoundError("paper not found");
    expect(err).toBeInstanceOf(ArxivError);
    expect(err).toBeInstanceOf(NotFoundError);
  });

  it("NotFoundError has code NOT_FOUND", () => {
    const err = new NotFoundError("x");
    expect(err.code).toBe("NOT_FOUND");
  });

  it("RateLimitedError is instanceof ArxivError with code RATE_LIMITED", () => {
    const err = new RateLimitedError("x");
    expect(err).toBeInstanceOf(ArxivError);
    expect(err.code).toBe("RATE_LIMITED");
  });

  it("NetworkError is instanceof ArxivError with code NETWORK", () => {
    const err = new NetworkError("x");
    expect(err).toBeInstanceOf(ArxivError);
    expect(err.code).toBe("NETWORK");
  });

  it("ParseError is instanceof ArxivError with code PARSE", () => {
    const err = new ParseError("x");
    expect(err).toBeInstanceOf(ArxivError);
    expect(err.code).toBe("PARSE");
  });

  it("UnsupportedError is instanceof ArxivError with code UNSUPPORTED", () => {
    const err = new UnsupportedError("x");
    expect(err).toBeInstanceOf(ArxivError);
    expect(err.code).toBe("UNSUPPORTED");
  });

  it("ArxivError defaults to code GENERIC", () => {
    const err = new ArxivError("x");
    expect(err.code).toBe("GENERIC");
    expect(err).toBeInstanceOf(Error);
  });

  it("error name matches the class name (via new.target)", () => {
    expect(new NotFoundError("x").name).toBe("NotFoundError");
    expect(new RateLimitedError("x").name).toBe("RateLimitedError");
    expect(new NetworkError("x").name).toBe("NetworkError");
    expect(new ParseError("x").name).toBe("ParseError");
    expect(new UnsupportedError("x").name).toBe("UnsupportedError");
    expect(new ArxivError("x").name).toBe("ArxivError");
  });
});

describe("exitCodeFor", () => {
  it("NotFoundError → 2", () => {
    expect(exitCodeFor(new NotFoundError("x"))).toBe(2);
  });

  it("RateLimitedError → 3", () => {
    expect(exitCodeFor(new RateLimitedError("x"))).toBe(3);
  });

  it("NetworkError → 4", () => {
    expect(exitCodeFor(new NetworkError("x"))).toBe(4);
  });

  it("ParseError → 5", () => {
    expect(exitCodeFor(new ParseError("x"))).toBe(5);
  });

  it("UnsupportedError → 6", () => {
    expect(exitCodeFor(new UnsupportedError("x"))).toBe(6);
  });

  it("plain ArxivError (GENERIC code) → 1", () => {
    expect(exitCodeFor(new ArxivError("x"))).toBe(1);
  });

  it("non-ArxivError (plain Error) → 1", () => {
    expect(exitCodeFor(new Error("boom"))).toBe(1);
  });

  it("non-Error values → 1", () => {
    expect(exitCodeFor("a string")).toBe(1);
    expect(exitCodeFor(42)).toBe(1);
    expect(exitCodeFor(null)).toBe(1);
    expect(exitCodeFor(undefined)).toBe(1);
  });
});
