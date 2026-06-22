#!/usr/bin/env node
import { Command, CommanderError, InvalidArgumentError, Option } from "commander";
import { ArxivClient } from "../core/client.js";
import { isEntrypoint } from "../core/is-main.js";
import type { ArxivConfig } from "../core/types.js";
import { VERSION } from "../core/version.js";
export { VERSION };
import { runSearch } from "./commands/search.js";
import type { SearchFlags } from "./commands/search.js";
import { runGet } from "./commands/get.js";
import type { GetFlags } from "./commands/get.js";
import { runRead } from "./commands/read.js";
import type { ReadFlags } from "./commands/read.js";
import { runRecent } from "./commands/recent.js";
import type { RecentFlags } from "./commands/recent.js";
import { runDownload } from "./commands/download.js";
import type { DownloadFlags } from "./commands/download.js";
import { runCache } from "./commands/cache.js";
import type { CacheAction } from "./commands/cache.js";

export type Stdio = { write(chunk: string): boolean };

export interface GlobalFlags {
  noCache?: boolean;
  cacheDir?: string;
  browser?: boolean;
  json?: boolean;
  quiet?: boolean;
  verbose?: boolean;
}

export interface CliDeps {
  createClient?: (flags: GlobalFlags) => ArxivClient;
  stdout?: Stdio;
  stderr?: Stdio;
  exit?: (code: number) => void;
}

export function defaultClientFactory(flags: GlobalFlags): ArxivClient {
  const overrides: Partial<ArxivConfig> = {};
  if (flags.noCache) overrides.noCache = true;
  if (flags.cacheDir) overrides.cacheDir = flags.cacheDir;
  if (flags.browser) overrides.browserFallback = true;
  return new ArxivClient(overrides);
}

type RawOpts = Record<string, unknown>;

function mergeGlobal(a: RawOpts, b: RawOpts): GlobalFlags {
  return {
    noCache: a.cache === false || b.cache === false ? true : undefined,
    browser: a.browser === true || b.browser === true ? true : undefined,
    cacheDir: (b.cacheDir as string | undefined) ?? (a.cacheDir as string | undefined),
    json: (b.json as boolean | undefined) ?? (a.json as boolean | undefined),
    quiet: (b.quiet as boolean | undefined) ?? (a.quiet as boolean | undefined),
    verbose: (b.verbose as boolean | undefined) ?? (a.verbose as boolean | undefined),
  };
}

function addCommonOptions(cmd: Command): void {
  cmd.option("--json", "Output JSON (scripting-friendly)");
  cmd.option("--no-cache", "Bypass the cache for this invocation");
  cmd.option("--cache-dir <dir>", "Cache directory");
  cmd.option("--browser", "Enable the browser fallback");
  cmd.option("--quiet", "Suppress non-essential stderr output (hints)");
  cmd.option("--verbose", "Print error stacks on failure");
}

function commanderExitCode(e: unknown): number {
  if (e instanceof CommanderError) return e.exitCode;
  return 1;
}

/**
 * Commander argParser for integer flags.
 * Throws InvalidArgumentError (commander surfaces as a usage error, exit 1)
 * when the value is not a valid finite integer.
 */
function parseIntFlag(v: string): number {
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new InvalidArgumentError(`Expected an integer, got: ${v}`);
  }
  return n;
}

export function createProgram(deps: CliDeps = {}): Command {
  const createClient = deps.createClient ?? defaultClientFactory;
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const exit = deps.exit ?? ((c: number) => {
    process.exitCode = c;
  });
  const io = {
    stdout: (s: string) => stdout.write(s),
    stderr: (s: string) => stderr.write(s),
  };

  const program = new Command();
  program
    .name("arxiv")
    .description("Search, read, and download arXiv papers")
    .version(VERSION);
  addCommonOptions(program);
  program.exitOverride();

  // --- search ---
  const search = program.command("search [query]");
  search.description("Search arXiv papers");
  addCommonOptions(search);
  search.option("--author <name>", "Filter by author");
  search.option("--category <cat>", "Filter by category");
  search.option("--title <text>", "Filter by title");
  search.option("--abstract <text>", "Filter by abstract");
  search.addOption(
    new Option("--sort <field>", "Sort by").default("relevance").choices(["relevance", "submitted", "updated"]),
  );
  search.addOption(
    new Option("--order <dir>", "Sort order").default("desc").choices(["asc", "desc"]),
  );
  search.option("--max <n>", "Maximum results", parseIntFlag, 25);
  search.option("--start <n>", "Start offset", parseIntFlag, 0);

  search.action(async function (query: string | undefined, opts: RawOpts) {
    const globalFlags = mergeGlobal(program.opts(), opts);
    const client = createClient(globalFlags);
    const flags: SearchFlags = {
      author: opts.author as string | undefined,
      category: opts.category as string | undefined,
      title: opts.title as string | undefined,
      abstract: opts.abstract as string | undefined,
      sort: opts.sort as SearchFlags["sort"],
      order: opts.order as "asc" | "desc" | undefined,
      max: opts.max as number | undefined,
      start: opts.start as number | undefined,
      json: globalFlags.json,
      quiet: globalFlags.quiet,
      verbose: globalFlags.verbose,
    };
    const code = await runSearch(client, query, flags, io);
    exit(code);
  });

  // --- get ---
  const get = program.command("get <id...>");
  get.description("Fetch metadata for one or more arXiv IDs");
  addCommonOptions(get);
  get.option("--bibtex", "Also fetch BibTeX for each ID");

  get.action(async function (ids: string[], opts: RawOpts) {
    const globalFlags = mergeGlobal(program.opts(), opts);
    const client = createClient(globalFlags);
    const flags: GetFlags = {
      bibtex: opts.bibtex as boolean | undefined,
      json: globalFlags.json,
      quiet: globalFlags.quiet,
      verbose: globalFlags.verbose,
    };
    const code = await runGet(client, ids, flags, io);
    exit(code);
  });

  // --- read ---
  const read = program.command("read <id>");
  read.description("Read the full text of an arXiv paper");
  addCommonOptions(read);
  read.addOption(
    new Option("--source <src>", "Content source")
      .default("auto")
      .choices(["auto", "html", "pdf"]),
  );
  read.addOption(
    new Option("--format <fmt>", "Output format")
      .default("markdown")
      .choices(["markdown", "text"]),
  );
  read.option("--section <name>", "Return a single named section");
  read.option("--max-chars <n>", "Soft chunk character target", parseIntFlag);
  read.option("--out <file>", "Write output to a file instead of stdout");

  read.action(async function (id: string, opts: RawOpts) {
    const globalFlags = mergeGlobal(program.opts(), opts);
    const client = createClient(globalFlags);
    const flags: ReadFlags = {
      source: opts.source as ReadFlags["source"],
      format: opts.format as ReadFlags["format"],
      section: opts.section as string | undefined,
      maxChars: opts.maxChars as number | undefined,
      out: opts.out as string | undefined,
      json: globalFlags.json,
      quiet: globalFlags.quiet,
      verbose: globalFlags.verbose,
    };
    const code = await runRead(client, id, flags, io);
    exit(code);
  });

  // --- recent ---
  const recent = program.command("recent <category>");
  recent.description("List the most recent papers in an arXiv category");
  addCommonOptions(recent);
  recent.option("--max <n>", "Maximum results", parseIntFlag);

  recent.action(async function (category: string, opts: RawOpts) {
    const globalFlags = mergeGlobal(program.opts(), opts);
    const client = createClient(globalFlags);
    const flags: RecentFlags = {
      max: opts.max as number | undefined,
      json: globalFlags.json,
      quiet: globalFlags.quiet,
      verbose: globalFlags.verbose,
    };
    const code = await runRecent(client, category, flags, io);
    exit(code);
  });

  // --- download ---
  const download = program.command("download <id...>");
  download.description("Download PDF(s) for one or more arXiv IDs");
  addCommonOptions(download);
  download.option("--out <dir>", "Directory to save PDFs (default: configured downloads dir)");

  download.action(async function (ids: string[], opts: RawOpts) {
    const globalFlags = mergeGlobal(program.opts(), opts);
    const client = createClient(globalFlags);
    const flags: DownloadFlags = {
      out: opts.out as string | undefined,
      json: globalFlags.json,
      quiet: globalFlags.quiet,
      verbose: globalFlags.verbose,
    };
    const code = await runDownload(client, ids, flags, io);
    exit(code);
  });

  // --- cache ---
  // The cache command does NOT construct an ArxivClient; it calls runCache with
  // the cacheDir resolved from the global --cache-dir flag (or env/config defaults).
  const cache = program.command("cache <action>");
  cache.description("Cache maintenance: 'path' prints the cache dir, 'clear' empties it");

  // cache does not call addCommonOptions — it only needs --cache-dir from the
  // global program options, which are already registered on the root program.
  // However, commander inherits the parent's parsed global opts via program.opts(),
  // so the --cache-dir value is available as program.opts().cacheDir inside the action.

  cache.action(async function (action: string, _opts: RawOpts) {
    const globalFlags = mergeGlobal(program.opts(), {});
    const code = await runCache(action as CacheAction, { cacheDir: globalFlags.cacheDir }, io);
    exit(code);
  });

  return program;
}

export async function run(argv: string[] = process.argv.slice(2), deps: CliDeps = {}): Promise<number> {
  let code = 0;
  const exit = (c: number) => {
    code = c;
    if (deps.exit) deps.exit(c);
    else process.exitCode = c;
  };
  const program = createProgram({ ...deps, exit });
  try {
    await program.parseAsync(argv, { from: "user" });
  } catch (e) {
    code = commanderExitCode(e);
    if (deps.exit) deps.exit(code);
    else process.exitCode = code;
  }
  return code;
}

if (isEntrypoint(import.meta.url)) {
  run().then((c) => {
    if (c !== 0) process.exit(c);
  });
}
