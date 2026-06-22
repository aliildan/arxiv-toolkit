#!/usr/bin/env node
import { Command, CommanderError, Option } from "commander";
import { ArxivClient } from "../core/client.js";
import type { ArxivConfig } from "../core/types.js";
import { runSearch } from "./commands/search.js";
import type { SearchFlags } from "./commands/search.js";

export const VERSION = "0.1.0";

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
    new Option("--order <dir>", "Sort order").default("descending").choices(["asc", "desc"]),
  );
  search.option("--max <n>", "Maximum results", (v: string) => Number(v), 25);
  search.option("--start <n>", "Start offset", (v: string) => Number(v), 0);

  search.action(async function (query: string | undefined, opts: RawOpts) {
    const globalFlags = mergeGlobal(program.opts(), opts);
    const client = createClient(globalFlags);
    const flags: SearchFlags = {
      author: opts.author as string | undefined,
      category: opts.category as string | undefined,
      title: opts.title as string | undefined,
      abstract: opts.abstract as string | undefined,
      sort: opts.sort as SearchFlags["sort"],
      order: opts.order as SearchFlags["order"],
      max: opts.max as number | undefined,
      start: opts.start as number | undefined,
      json: globalFlags.json,
      quiet: globalFlags.quiet,
      verbose: globalFlags.verbose,
    };
    const code = await runSearch(client, query, flags, io);
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

if (import.meta.url === `file://${process.argv[1]}`) {
  run().then((c) => {
    if (c !== 0) process.exit(c);
  });
}

void (null as unknown as ArxivConfig);
