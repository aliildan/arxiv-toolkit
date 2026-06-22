import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Live tests (test/live/**) hit the real arXiv endpoints. They are opt-in:
    // excluded from the default/CI run, collected only when ARXIV_LIVE is set
    // (and then self-gated again via describe.skipIf for belt-and-suspenders).
    exclude: process.env.ARXIV_LIVE ? [] : ["test/live/**"],
    environment: "node",
  },
});
