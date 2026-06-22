# arXiv query reference (for the literature-review skill)

How to turn a research intent into effective `arxiv_search` calls (and `arxiv` CLI flags).

## Search fields → tool parameters

`arxiv_search` exposes these; field params are **ANDed** together.

| Intent | MCP param | CLI flag | Notes |
|---|---|---|---|
| Free-text / phrase | `query` | positional `<query>` | matched broadly (all fields); multi-word is treated as a phrase |
| Title contains | `title` | `--title` | best for finding surveys/named methods |
| Author | `author` | `--author` | last name works well |
| Abstract contains | `abstract` | `--abstract` | scope to a concept |
| Category | `category` | `--category` | the strongest narrowing lever (see below) |
| Sort key | `sortBy` | `--sort` | `relevance` \| `submittedDate` \| `lastUpdatedDate` |
| Sort order | `sortOrder` | `--order` | `ascending` \| `descending` |
| Page size | `maxResults` | `--max` | clamped to ≤ 2000 by the toolkit |
| Offset | `start` | `--start` | avoid for discovery — see "Narrowing" |

**Boolean / alternatives:** the tool ANDs the field params and treats `query` as a phrase — it does **not** expose raw `OR`/`ANDNOT`. To cover alternative framings or synonyms (e.g. "speculative decoding" vs "draft-and-verify"), run **multiple complementary searches and merge by id**, rather than trying to pack everything into one query.

## Choosing the sort

- **`relevance`** (default) — foundational and most-cited-adjacent work surfaces first. Use for the "what are the key papers" pass.
- **`submittedDate` descending** — the recent frontier. Use for "recent advances / 2024–2026 work".
- **`lastUpdatedDate`** — catches revised versions.

## Narrowing a large result set (the key move)

When `total` is large or the result includes `hints`, **narrow — don't paginate**:

1. Add a `category` (most effective).
2. Add an `abstract` term that pins the concept.
3. Switch to `submittedDate` + a recent window if you only want current work.
4. Use a `title` scope to isolate surveys/named methods.

Only use `start` when you have a *specific* reason (e.g. a known paper by title is missing from page 1). Blind paging floods context with low-relevance hits, and deep `start` values are unreliable on arXiv.

## Common categories

Pick the category that matches the topic; cross-list searches (e.g. a paper in both `cs.CL` and `cs.LG`) are common.

| Category | Area |
|---|---|
| `cs.CL` | Computation & Language (NLP, LLMs) |
| `cs.LG` | Machine Learning |
| `cs.AI` | Artificial Intelligence |
| `cs.CV` | Computer Vision |
| `cs.NE` | Neural & Evolutionary Computing |
| `cs.IR` | Information Retrieval |
| `cs.RO` | Robotics |
| `stat.ML` | Statistics — Machine Learning |
| `eess.AS` | Audio & Speech Processing |
| `math.OC` | Optimization & Control |
| `q-bio.*` | Quantitative Biology |
| `cond-mat.*` | Condensed Matter Physics |

Full taxonomy: <https://arxiv.org/category_taxonomy>.

## arXiv id formats (for `arxiv_get_metadata` / `arxiv_read_paper` / `arxiv_download`)

- **New style:** `2310.06825` (optionally versioned: `2310.06825v2`).
- **Old style:** `cond-mat/0011267` (keep the slash).
- URLs are accepted too (`https://arxiv.org/abs/2310.06825`); the toolkit normalizes them.

## Reading efficiently

`arxiv_read_paper` returns section-aware Markdown (or `format: "text"` for plain text):

- `section: "method"` — pull one section by id (`S3`) or a title substring.
- `maxChars: 4000` — cap a chunk; a `nextCursor` is returned when more remains. Pass it back (same `id`) to continue.
- For a typical deep read: abstract → method → results. Reading every section of every paper is usually wasted effort and rate-limited calls.
