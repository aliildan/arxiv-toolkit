import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import envPaths from "env-paths";
import type { ArxivConfig } from "./types.js";

const require = createRequire(import.meta.url);

interface PkgMeta {
  version: string;
  repository?: string | { url?: string };
  author?: string | { email?: string };
}

function readPkg(): PkgMeta {
  // Resolve the project root package.json relative to this source file.
  // __dirname is unavailable in ESM; derive it from import.meta.url.
  const here = dirname(fileURLToPath(import.meta.url));
  // dist/core/config.js -> ../../package.json ; src/core/config.ts -> ../../package.json
  // try a couple of depths so it works both from src (vitest) and dist.
  const candidates = [
    join(here, "..", "..", "package.json"),
    join(here, "..", "..", "..", "package.json"),
  ];
  for (const p of candidates) {
    try {
      return require(p) as PkgMeta;
    } catch {
      // try next
    }
  }
  return { version: "0.0.0" };
}

function repoUrl(pkg: PkgMeta): string {
  if (!pkg.repository) return "https://github.com/anthropics/arxiv-toolkit";
  if (typeof pkg.repository === "string") return pkg.repository;
  return pkg.repository.url ?? "https://github.com/anthropics/arxiv-toolkit";
}

function authorEmail(pkg: PkgMeta): string | undefined {
  if (!pkg.author) return undefined;
  if (typeof pkg.author === "string") {
    // "Name <email>" format
    const m = pkg.author.match(/<([^>]+)>/);
    return m ? m[1] : undefined;
  }
  return pkg.author.email;
}

function isTruthy(v: string | undefined): boolean {
  if (v === undefined) return false;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

function readConfigFile(configDir: string): Partial<ArxivConfig> {
  try {
    const raw = readFileSync(join(configDir, "config.json"), "utf8");
    return JSON.parse(raw) as Partial<ArxivConfig>;
  } catch {
    return {};
  }
}

function buildUserAgent(pkg: PkgMeta, contact?: string): string {
  const repo = repoUrl(pkg);
  if (contact && contact.length > 0) {
    return `arxiv-toolkit/${pkg.version} (+${repo}; mailto:${contact})`;
  }
  return `arxiv-toolkit/${pkg.version} (+${repo})`;
}

/**
 * Resolve a fully-populated ArxivConfig.
 * Precedence: overrides > env vars > config file > defaults.
 */
export function resolveConfig(overrides?: Partial<ArxivConfig>): ArxivConfig {
  const pkg = readPkg();
  const paths = envPaths("arxiv-toolkit", { suffix: "" });

  const defaults: ArxivConfig = {
    cacheDir: paths.cache,
    downloadsDir: join(paths.data, "papers"),
    configDir: paths.config,
    rateMs: 3000,
    userAgent: "",
    contact: undefined,
    noCache: false,
    defaultMaxResults: 25,
    browserFallback: false,
  };

  // configDir must be resolved from overrides first BEFORE we read the file.
  let configDir: string = defaults.configDir;
  if (overrides?.configDir) configDir = overrides.configDir;
  const file = readConfigFile(configDir);

  const fromEnv: Partial<ArxivConfig> = {};
  if (process.env.ARXIV_CACHE_DIR) fromEnv.cacheDir = process.env.ARXIV_CACHE_DIR;
  if (process.env.ARXIV_DOWNLOADS_DIR) fromEnv.downloadsDir = process.env.ARXIV_DOWNLOADS_DIR;
  if (process.env.ARXIV_RATE_MS) fromEnv.rateMs = Number(process.env.ARXIV_RATE_MS);
  if (process.env.ARXIV_MAX_RESULTS) fromEnv.defaultMaxResults = Number(process.env.ARXIV_MAX_RESULTS);
  if (process.env.ARXIV_NO_CACHE) fromEnv.noCache = isTruthy(process.env.ARXIV_NO_CACHE);
  if (process.env.ARXIV_BROWSER) fromEnv.browserFallback = isTruthy(process.env.ARXIV_BROWSER);
  if (process.env.ARXIV_CONTACT) fromEnv.contact = process.env.ARXIV_CONTACT;
  if (process.env.ARXIV_USER_AGENT) fromEnv.userAgent = process.env.ARXIV_USER_AGENT;

  const merged: ArxivConfig = {
    ...defaults,
    ...file,
    ...fromEnv,
    ...(overrides ?? {}),
    configDir,
  } as ArxivConfig;

  // User-Agent: ARXIV_USER_AGENT (already in merged) wins; otherwise assemble.
  if (process.env.ARXIV_USER_AGENT) {
    // Already set from env above; leave it.
  } else if (overrides?.userAgent) {
    // Already set from overrides above; leave it.
  } else {
    // Resolve contact: env/override > package.json author.email (spec §9).
    if (!merged.contact) {
      merged.contact = authorEmail(pkg);
    }
    merged.userAgent = buildUserAgent(pkg, merged.contact);
  }

  return merged;
}
