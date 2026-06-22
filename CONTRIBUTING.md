# Contributing to arxiv-toolkit

## Prerequisites

- **Building and developing** this package requires **Node >= 22.18** (or >= 24.11).
  The build tool, `tsdown@0.22.3`, declares `engines` of `^22.18 || >=24.11`.
  This is a **build-only** requirement and is recorded in `package.json#devEngines`.
- The **published package** runs on **Node >= 20.19** (recorded in
  `package.json#engines.node`). Do not raise `engines.node` to satisfy the build --
  that would block runtime consumers on Node 20. CI must use >= 22.18.

## Setup

```bash
node --version   # confirm >= 22.18
npm install
npm run build     # tsdown -> dist/{index,cli,mcp}.js (+ .d.ts, bin shebangs)
npm test          # vitest unit + adapter tests (no network)
npm run typecheck  # tsc --noEmit
```

## Live integration tests

Tests that hit the real arXiv endpoints are gated behind `ARXIV_LIVE=1` and are
**excluded from CI**:

```bash
ARXIV_LIVE=1 npm test
```

## Conventions

- **ESM + NodeNext.** `"type": "module"`. All relative imports carry the `.js` suffix.
- **TDD.** Write the failing test first, watch it fail, implement minimally, watch it pass.
- **One focused commit per task**, conventional-commit messages.
- **arXiv etiquette is mandatory:** descriptive User-Agent with contact, per-host min-interval limiter (default 3000 ms), retry/backoff on 429/5xx, `max_results` clamped to <= 2000.
