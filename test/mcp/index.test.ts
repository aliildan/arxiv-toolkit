import { describe, it, expect, vi, afterEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { main } from "../../src/mcp/index.js";
import type { ArxivClient } from "../../src/core/client.js";

function mockClient(): ArxivClient {
  return {} as unknown as ArxivClient;
}

describe("mcp index main", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls server.connect(transport) — real SDK dispatch, not transport.connect(server)", async () => {
    // Spy on the real McpServer.prototype.connect so we can assert the direction.
    const connectSpy = vi.spyOn(McpServer.prototype, "connect").mockResolvedValue(undefined);
    const transport = new StdioServerTransport();
    await main({ client: mockClient(), transport });
    expect(connectSpy).toHaveBeenCalledTimes(1);
    expect(connectSpy).toHaveBeenCalledWith(transport);
  });

  it("propagates transport connect errors", async () => {
    vi.spyOn(McpServer.prototype, "connect").mockRejectedValue(new Error("stdio broken"));
    const transport = new StdioServerTransport();
    await expect(main({ client: mockClient(), transport })).rejects.toThrow("stdio broken");
  });
});
