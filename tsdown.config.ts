import { defineConfig } from "tsdown";

// Phase 1: only the library entry exists.
// Phase 11 (Packaging) adds the cli and mcp entries together with their
// #!/usr/bin/env node bin shebangs via tsdown's native shebang support —
// at that point this file gains two more entries:
//   { entry: "src/cli/index.ts", platform: "node", banner: { js: "#!/usr/bin/env node" } }
//   { entry: "src/mcp/index.ts", platform: "node", banner: { js: "#!/usr/bin/env node" } }
// Do NOT add those entries now; cli/mcp source files don't exist yet and
// tsdown would fail the build.

export default defineConfig({
  entry: {
    index: "src/index.ts",
  },
  format: ["esm"],
  dts: true,
  platform: "node",
  clean: true,
});
