import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    cli: "src/cli/index.ts",
    mcp: "src/mcp/index.ts",
  },
  format: ["esm"],
  dts: true,
  platform: "node",
  clean: true,
  outExtensions: () => ({ js: ".js", dts: ".d.ts" }),
});
