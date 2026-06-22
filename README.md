# arxiv-toolkit

A TypeScript library exposed as a **CLI** (`arxiv`) and an **MCP server** (`arxiv-mcp`) for
searching arXiv, fetching metadata, and reading papers as clean, section-aware Markdown
(HTML → ar5iv → PDF fallback). API-first over arXiv's official endpoints, with a lazy
browser fallback (off by default).

- **Search & discovery** — full-text and field-scoped search (title, author, abstract, category), boolean queries, sorting, pagination, and a "recent in a category" listing.
- **Read full text** — section-aware Markdown (or plain text), chunkable via `maxChars`/`cursor` so an LLM can read large papers within a context budget.
- **Metadata & export** — rich metadata for one or many IDs and BibTeX export (canonical arXiv endpoint, with an offline `@misc` generator fallback).
- **Polite & portable** — per-host rate limiting, retry/backoff, aggressive caching, OS-native paths. No browser required.

## Install

### Global

```bash
npm install -g arxiv-toolkit
```

After global install, both bins are on `PATH`:

```bash
arxiv search "transformer attention"
arxiv-mcp   # starts the stdio MCP server
```

### npx (no global install)

> **Gotcha:** the bin names (`arxiv`, `arxiv-mcp`) differ from the package name
> (`arxiv-toolkit`). `npx arxiv-toolkit ...` does **not** resolve to the bins — use
> `--package`:

```bash
npx -y --package arxiv-toolkit arxiv search "transformer attention"
npx -y --package arxiv-toolkit arxiv read 2310.06825
npx -y --package arxiv-toolkit arxiv-mcp
```

## CLI usage

```
arxiv <command> [options]

Commands:
  search <query>          Search arXiv.
  get <id...>             Fetch metadata for one or more IDs.
  read <id>               Read a paper as Markdown/text.
  download <id...>        Save PDF(s) to disk.
  recent <category>       Latest papers in a category.
  cache <clear|path>      Cache maintenance.

Global options:
  --json              JSON output (scripting)
  --no-cache          Bypass cache
  --cache-dir <dir>   Override cache directory
  --browser           Enable browser fallback (off by default)
  --quiet             Suppress hints/non-fatal warnings
  --verbose           Print stack traces on error
```

### search

```bash
arxiv search "diffusion models" --author "ho" --category cs.LG --sort submitted --max 20 --json
```

Flags: `--author --category --title --abstract --sort relevance|submitted|updated --order asc|desc --max <n> --start <n> --json`. For large result sets (>1000), a narrowing hint is printed to stderr (suppressed by `--quiet`).

### get (metadata + BibTeX)

```bash
arxiv get 2310.06825 cond-mat/0011267
arxiv get 2310.06825 --bibtex --json
```

`get` accepts multiple IDs; the metadata is batched (≤50 IDs per request) and returned in input order. `--bibtex` emits canonical BibTeX from arXiv's `https://arxiv.org/bibtex/{id}` endpoint, falling back to a generated `@misc` entry offline.

### read (full text)

```bash
arxiv read 2310.06825
arxiv read 2310.06825 --format text --section "Method"
arxiv read 2310.06825 --source pdf --max-chars 12000 --out paper.md
```

Flags: `--source auto|html|pdf` (default `auto`: native HTML → ar5iv → PDF), `--format markdown|text` (default `markdown`), `--section <name>` (return one section by `S1`-style id or title substring), `--max-chars <n>` (soft chunk target; snaps to whole-section boundaries), `--out <file>`. Use `--max-chars` to read a paper section-by-section; the `nextCursor` field in `--json` output is the authoritative "more remains" signal.

### download

```bash
arxiv download 2310.06825 cond-mat/0011267 --out ./papers
```

`download <id...>` saves each PDF (old-style IDs are sanitized on disk: `cond-mat/0011267` → `cond-mat_0011267.pdf`). The absolute saved path is printed per ID; processing continues on error and the process exits non-zero if any ID failed.

### recent

```bash
arxiv recent cs.CL --max 10 --json
```

### cache

```bash
arxiv cache clear   # empty the cache
arxiv cache path    # print the cache directory
```

## MCP server

`arxiv-mcp` is a [Model Context Protocol](https://modelcontextprotocol.io) stdio server exposing the same core as five tools: `arxiv_search`, `arxiv_get_metadata`, `arxiv_read_paper`, `arxiv_list_recent`, `arxiv_download`.

### Claude Code

Register the server for your user scope:

```bash
claude mcp add arxiv --scope user -- npx -y --package arxiv-toolkit arxiv-mcp
```

Options go **before** the name and `--` goes **before** the command. The registered server name `arxiv` and the bin `arxiv-mcp` are intentionally distinct (logical name vs. launcher). Verify with `claude mcp list`.

### Config-file forms

Equivalent static config for `.mcp.json` (Claude Code) or `claude_desktop_config.json` (Claude Desktop):

```jsonc
{
  "mcpServers": {
    "arxiv": {
      "command": "npx",
      "args": ["-y", "--package", "arxiv-toolkit", "arxiv-mcp"]
    }
  }
}
```

With a global install, use the bin directly:

```jsonc
{
  "mcpServers": {
    "arxiv": {
      "command": "arxiv-mcp"
    }
  }
}
```

### Tools

| Tool | Purpose |
|---|---|
| `arxiv_search` | Search arXiv; returns `{total,start,count,papers[],hints[]}` + text summary. |
| `arxiv_get_metadata` | Metadata for one or more IDs; optional BibTeX. |
| `arxiv_read_paper` | Section-aware Markdown/text with `nextCursor` for chunked reads. |
| `arxiv_list_recent` | Recent papers in a category. |
| `arxiv_download` | Save a PDF; returns the absolute path + a `file://` resource link. |

## Browser fallback (off by default)

The API-first path (official arXiv endpoints) is the default and needs no browser. An
optional browser fallback (`playwright-core`, an `optionalDependency`, lazy-loaded) can
retry the **same** URLs when the API path fails for a **non-content** reason (e.g. a
challenge/`403`, or repeated `5xx`/connection/TLS failure after retries are exhausted).
It is **not** triggered by a clean `404` (a legitimate "not available here" → the source
matrix continues to the next source).

Enable it with:

- the `--browser` CLI flag,
- the `ARXIV_BROWSER=1` environment variable, or
- `"browserFallback": true` in the config file.

If no browser binary is installed when the fallback is engaged, `arxiv-toolkit` raises a
clear `UnsupportedError` with install guidance and **leaves the API path unaffected** — it
never breaks the default flow. Cache maintenance is CLI/ops-only; there is no MCP cache
tool.

## Configuration

Configuration is resolved with precedence: CLI flag → environment variable → config file → default. The config file is `<configDir>/config.json` (a `Partial<ArxivConfig>` JSON object; unknown keys are ignored).

| Env var | Field | Notes |
|---|---|---|
| `ARXIV_CACHE_DIR` | `cacheDir` | Cache directory. |
| `ARXIV_DOWNLOADS_DIR` | `downloadsDir` | Default `<data>/papers`. |
| `ARXIV_RATE_MS` | `rateMs` | Per-host min-interval (default 3000). |
| `ARXIV_MAX_RESULTS` | `defaultMaxResults` | Default page size (default 25; the 2000 clamp is fixed). |
| `ARXIV_NO_CACHE` | `noCache` | `1`/`true`/`yes` to bypass. |
| `ARXIV_BROWSER` | `browserFallback` | `1`/`true`/`yes` to enable. |
| `ARXIV_CONTACT` | `contact` | Email used in the User-Agent. |
| `ARXIV_USER_AGENT` | `userAgent` | Overrides the entire UA string. |

Paths are cross-platform via `env-paths`. A descriptive `User-Agent` with a contact email
is sent on every request; please set `ARXIV_CONTACT` to your email so arXiv can reach you
if your usage causes problems.

## Bulk access (out of scope)

This toolkit is for targeted search and reading, not bulk harvesting. For large-scale
access use arXiv's official bulk channels:

- **OAI-PMH** — `https://oaipmh.arxiv.org/oai`
- **AWS S3 (requester-pays)** — `s3://arxiv` (`pdf/`, `src/` + manifests). See [arXiv S3 bulk data](https://info.arxiv.org/help/bulk_data_s3.html).
- **Kaggle** — [Cornell University/arxiv](https://www.kaggle.com/datasets/Cornell-University/arxiv) dump.

See [arXiv bulk data](https://info.arxiv.org/help/bulk_data.html) for guidance and etiquette.

## License

MIT. See [LICENSE](./LICENSE).
