---
name: literature-review
description: Use when a user asks for a literature review, survey, "related work", or "what's the state of the art / recent advances" on a research topic — and the arXiv tools (the arxiv-mcp server's arxiv_* tools, or the `arxiv` CLI) are available.
---

# Literature Review (arXiv)

## Overview

Turn a research topic into a synthesized, cited review: search arXiv, read a focused set of key papers in chunks, and organize findings by theme. Built on the [arxiv-toolkit](https://www.npmjs.com/package/arxiv-toolkit) (`arxiv-mcp` tools, or the `arxiv` CLI as a fallback).

**Core principle: narrow and synthesize.** Read a *right-sized* set of papers well, organized by theme — not a paper-by-paper dump, and not 80 tool calls.

## When to use

- "Review the literature on X" / "survey of X" / "related work for X"
- "What's the state of the art / recent advances in X?"
- Orienting in a new area, or drafting a related-work section.

**Prerequisite:** the `arxiv-mcp` server is registered (the five tools below), or the `arxiv` CLI is installed.

## Workflow

**1. Scope first — do not skip.** Before any search, settle: the key terms, the likely arXiv categories (e.g. `cs.CL`, `cs.LG` — see `references/arxiv-query-syntax.md`), the time window, and the depth. If the request is broad, ask ONE scoping question: a quick orientation (~5 papers), a standard review (~8–12), or exhaustive? Diving in without this wastes dozens of calls.

**2. Discover.** `arxiv_search` with field scoping (`category`, `title`, `abstract`) and the right sort — `relevance` for foundational work, `submittedDate` for the recent frontier. Run 2–3 complementary searches (broad terms; a title-scoped pass for surveys; a recent-sorted pass). If `total` is large or `hints` fire, **narrow by category/date — never blind-paginate with `start`.**

**3. Triage.** `arxiv_get_metadata(ids, bibtex: true)` on the candidates. Rank by fit + recency. Pick a deep-read set sized to the scope (**default 5–8**); list the rest as "also relevant."

**4. Read — targeted, not exhaustive.** For each chosen paper, read the abstract, then only the sections that matter (usually method + results) via `arxiv_read_paper(section=…)`, or `maxChars` + `nextCursor` to walk a long section. After each paper, distill to 3–5 notes (contribution, method, result, limitation) and drop the raw text. **Don't read every section of every paper.**

**5. Synthesize by theme.** Group approaches into themes, contrast them, and surface agreements, trends, and open gaps. The output is a synthesis, not an annotated list.

**6. Cite.** Emit a BibTeX bibliography from the metadata already gathered. Offer `arxiv_download` for PDFs.

## Tools

| Tool | Use |
|---|---|
| `arxiv_search` | discover (field-scoped, sorted) |
| `arxiv_get_metadata` | triage + BibTeX |
| `arxiv_read_paper` | chunked section reads (`section` / `maxChars` / `cursor`) |
| `arxiv_list_recent` | scan a category's newest |
| `arxiv_download` | save PDFs |

CLI equivalents: `arxiv search` / `get` / `read` / `recent` / `download` (see the toolkit README).

## Output

Overview → thematic sections with inline citations (`Author et al., YEAR, arXiv:ID`) → a short comparison (a table when speedups/metrics invite one) → open problems → a BibTeX references block. Scale the length to the scope from step 1.

## Common mistakes

- **Over-fetching.** Reading 15+ papers in full is dozens of rate-limited calls — the toolkit deliberately spaces requests (~3 s per host), so that plan is minutes of waiting and it crowds out the synthesis. Right-size the deep-read set; read targeted sections.
- **Blind deep-paging.** A large result set means narrow the query (category/date), not walk `start`.
- **Paper-by-paper dump.** Organize by theme, not "Paper 1… Paper 2…".
- **No citations.** Gather BibTeX as you go (`arxiv_get_metadata(bibtex: true)`), not at the end from memory.
- **Skipping scope.** Clarify depth/breadth before searching.
