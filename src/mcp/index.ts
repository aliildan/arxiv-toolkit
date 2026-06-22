#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ArxivClient } from "../core/client.js";
import { buildServer } from "./server.js";

export interface BootDeps {
  client?: ArxivClient;
  transport?: StdioServerTransport;
}

export async function main(deps: BootDeps = {}): Promise<void> {
  const client = deps.client ?? new ArxivClient();
  const server = buildServer(client);
  await server.connect(deps.transport ?? new StdioServerTransport());
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
