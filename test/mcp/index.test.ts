import { describe, it, expect, vi } from "vitest";
import { main } from "../../src/mcp/index.js";
import type { ArxivClient } from "../../src/core/client.js";

function mockClient(): ArxivClient {
  return {} as unknown as ArxivClient;
}

describe("mcp index main", () => {
  it("connects the built server to the transport", async () => {
    const transport = { connect: vi.fn(async (_server: unknown) => {}) };
    await main({ client: mockClient(), transport });
    expect(transport.connect).toHaveBeenCalledTimes(1);
    expect(transport.connect).toHaveBeenCalledWith(expect.objectContaining({ registerTool: expect.any(Function) }));
  });

  it("propagates transport connect errors", async () => {
    const transport = { connect: vi.fn(async () => { throw new Error("stdio broken"); }) };
    await expect(main({ client: mockClient(), transport })).rejects.toThrow("stdio broken");
  });
});
