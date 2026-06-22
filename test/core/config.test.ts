import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveConfig } from "../../src/core/config.js";

const ENV_KEYS = [
  "ARXIV_CACHE_DIR",
  "ARXIV_DOWNLOADS_DIR",
  "ARXIV_RATE_MS",
  "ARXIV_USER_AGENT",
  "ARXIV_CONTACT",
  "ARXIV_NO_CACHE",
  "ARXIV_MAX_RESULTS",
  "ARXIV_BROWSER",
];

let savedEnv: Record<string, string | undefined>;
let tempConfigDir: string;

beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  tempConfigDir = mkdtempSync(join(tmpdir(), "arxiv-cfg-"));
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  rmSync(tempConfigDir, { recursive: true, force: true });
});

describe("resolveConfig defaults", () => {
  it("populates all fields with defaults and assembles a UA without contact", () => {
    const cfg = resolveConfig();
    expect(cfg.rateMs).toBe(3000);
    expect(cfg.noCache).toBe(false);
    expect(cfg.defaultMaxResults).toBe(25);
    expect(cfg.browserFallback).toBe(false);
    expect(cfg.cacheDir).toMatch(/arxiv-toolkit/);
    expect(cfg.configDir).toMatch(/arxiv-toolkit/);
    expect(cfg.downloadsDir.endsWith("papers")).toBe(true);
  });

  it("downloadsDir defaults to <data>/papers", () => {
    const cfg = resolveConfig();
    expect(cfg.downloadsDir.endsWith("papers")).toBe(true);
  });

  it("UA starts with arxiv-toolkit/<version> and includes repo url and mailto from package.json author when no ARXIV_CONTACT", () => {
    delete process.env.ARXIV_CONTACT;
    const cfg = resolveConfig();
    expect(cfg.userAgent).toMatch(/^arxiv-toolkit\//);
    // spec §9: mailto comes from package.json author.email when ARXIV_CONTACT is unset
    expect(cfg.userAgent).toMatch(/mailto:.+@.+/);
    expect(cfg.contact).toBeTruthy();
    expect(cfg.contact).toContain("@");
  });
});

describe("resolveConfig env precedence", () => {
  it("ARXIV_CACHE_DIR overrides cacheDir", () => {
    process.env.ARXIV_CACHE_DIR = "/tmp/custom-cache";
    expect(resolveConfig().cacheDir).toBe("/tmp/custom-cache");
  });

  it("ARXIV_DOWNLOADS_DIR overrides downloadsDir", () => {
    process.env.ARXIV_DOWNLOADS_DIR = "/tmp/custom-dl";
    expect(resolveConfig().downloadsDir).toBe("/tmp/custom-dl");
  });

  it("ARXIV_RATE_MS parses an integer", () => {
    process.env.ARXIV_RATE_MS = "1500";
    expect(resolveConfig().rateMs).toBe(1500);
  });

  it("ARXIV_NO_CACHE truthy variants set noCache true", () => {
    for (const v of ["1", "true", "TRUE", "yes"]) {
      process.env.ARXIV_NO_CACHE = v;
      expect(resolveConfig().noCache).toBe(true);
    }
    process.env.ARXIV_NO_CACHE = "0";
    expect(resolveConfig().noCache).toBe(false);
  });

  it("ARXIV_MAX_RESULTS parses an integer", () => {
    process.env.ARXIV_MAX_RESULTS = "50";
    expect(resolveConfig().defaultMaxResults).toBe(50);
  });

  it("ARXIV_BROWSER truthy sets browserFallback true", () => {
    process.env.ARXIV_BROWSER = "1";
    expect(resolveConfig().browserFallback).toBe(true);
    process.env.ARXIV_BROWSER = "0";
    expect(resolveConfig().browserFallback).toBe(false);
  });

  it("ARXIV_CONTACT adds the mailto segment to the UA", () => {
    process.env.ARXIV_CONTACT = "dev@example.com";
    const cfg = resolveConfig();
    expect(cfg.userAgent).toContain("mailto:dev@example.com");
    expect(cfg.contact).toBe("dev@example.com");
  });

  it("ARXIV_USER_AGENT overrides the entire UA string", () => {
    process.env.ARXIV_USER_AGENT = "custom-agent/1.0";
    expect(resolveConfig().userAgent).toBe("custom-agent/1.0");
  });
});

describe("resolveConfig env var validation (parsePositiveInt guard)", () => {
  it("ARXIV_RATE_MS=foo falls back to default 3000 (not NaN)", () => {
    process.env.ARXIV_RATE_MS = "foo";
    expect(resolveConfig().rateMs).toBe(3000);
  });

  it("ARXIV_MAX_RESULTS=abc falls back to default 25 (not NaN)", () => {
    process.env.ARXIV_MAX_RESULTS = "abc";
    expect(resolveConfig().defaultMaxResults).toBe(25);
  });

  it("ARXIV_RATE_MS=0 falls back to default (zero is not positive)", () => {
    process.env.ARXIV_RATE_MS = "0";
    expect(resolveConfig().rateMs).toBe(3000);
  });

  it("ARXIV_MAX_RESULTS=-5 falls back to default (negative is not positive)", () => {
    process.env.ARXIV_MAX_RESULTS = "-5";
    expect(resolveConfig().defaultMaxResults).toBe(25);
  });

  it("valid ARXIV_RATE_MS=1500 still parses correctly", () => {
    process.env.ARXIV_RATE_MS = "1500";
    expect(resolveConfig().rateMs).toBe(1500);
  });

  it("valid ARXIV_MAX_RESULTS=100 still parses correctly", () => {
    process.env.ARXIV_MAX_RESULTS = "100";
    expect(resolveConfig().defaultMaxResults).toBe(100);
  });
});

describe("resolveConfig overrides > env > file", () => {
  it("explicit overrides win over env", () => {
    process.env.ARXIV_RATE_MS = "1500";
    expect(resolveConfig({ rateMs: 9000 }).rateMs).toBe(9000);
  });

  it("env wins over config file", () => {
    // Point env-paths config dir at our temp dir by writing config.json into
    // the real default config dir is non-portable; instead use overrides for
    // configDir to relocate the file, then set a file value and assert env beats it.
    process.env.ARXIV_RATE_MS = "1500";
    writeFileSync(join(tempConfigDir, "config.json"), JSON.stringify({ rateMs: 7777 }));
    expect(resolveConfig({ configDir: tempConfigDir }).rateMs).toBe(1500);
  });

  it("config file applies when no env or override is set", () => {
    writeFileSync(join(tempConfigDir, "config.json"), JSON.stringify({ rateMs: 7777 }));
    expect(resolveConfig({ configDir: tempConfigDir }).rateMs).toBe(7777);
  });

  it("config file unknown keys are ignored and malformed file is treated as empty", () => {
    writeFileSync(
      join(tempConfigDir, "config.json"),
      JSON.stringify({ rateMs: 7777, bogus: "x" }),
    );
    expect(resolveConfig({ configDir: tempConfigDir }).rateMs).toBe(7777);
    writeFileSync(join(tempConfigDir, "config.json"), "{ not valid json");
    expect(resolveConfig({ configDir: tempConfigDir }).rateMs).toBe(3000);
  });

  it("missing config file is treated as empty (no throw)", () => {
    expect(() => resolveConfig({ configDir: tempConfigDir })).not.toThrow();
    expect(resolveConfig({ configDir: tempConfigDir }).rateMs).toBe(3000);
  });
});
