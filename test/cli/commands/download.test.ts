import { describe, it, expect, vi } from "vitest";
import { runDownload } from "../../../src/cli/commands/download.js";
import type { ArxivClient } from "../../../src/core/client.js";
import { NotFoundError, NetworkError } from "../../../src/core/errors.js";

function sink() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: {
      stdout: (s: string) => { out.push(s); },
      stderr: (s: string) => { err.push(s); },
    },
  };
}

describe("runDownload", () => {
  it("calls client.download for each id and prints the absolute path to stdout", async () => {
    const client = {
      download: vi.fn()
        .mockResolvedValueOnce({ path: "/home/user/papers/1706.03762v1.pdf", bytes: 1024 })
        .mockResolvedValueOnce({ path: "/home/user/papers/2310.06825.pdf", bytes: 2048 }),
    } as unknown as ArxivClient;
    const { out, err, io } = sink();
    const code = await runDownload(client, ["1706.03762", "2310.06825"], {}, io);
    expect(code).toBe(0);
    expect(client.download).toHaveBeenCalledTimes(2);
    expect(client.download).toHaveBeenCalledWith("1706.03762", {});
    expect(client.download).toHaveBeenCalledWith("2310.06825", {});
    expect(out.join("")).toContain("/home/user/papers/1706.03762v1.pdf");
    expect(out.join("")).toContain("/home/user/papers/2310.06825.pdf");
    expect(err).toEqual([]);
  });

  it("passes --out dir to client.download as dir option", async () => {
    const client = {
      download: vi.fn().mockResolvedValue({ path: "/custom/dir/1706.03762.pdf", bytes: 512 }),
    } as unknown as ArxivClient;
    const { io } = sink();
    await runDownload(client, ["1706.03762"], { out: "/custom/dir" }, io);
    expect(client.download).toHaveBeenCalledWith("1706.03762", { dir: "/custom/dir" });
  });

  it("emits JSON lines to stdout in --json mode", async () => {
    const client = {
      download: vi.fn().mockResolvedValue({ path: "/papers/1706.03762.pdf", bytes: 100 }),
    } as unknown as ArxivClient;
    const { out, io } = sink();
    const code = await runDownload(client, ["1706.03762"], { json: true }, io);
    expect(code).toBe(0);
    const parsed = JSON.parse(out.join(""));
    expect(parsed).toEqual({ id: "1706.03762", path: "/papers/1706.03762.pdf", bytes: 100 });
  });

  it("continues on error, reports failed id to stderr, and returns first failure exit code", async () => {
    const client = {
      download: vi.fn()
        .mockRejectedValueOnce(new NotFoundError("1706.03762 not found"))
        .mockResolvedValueOnce({ path: "/papers/2310.06825.pdf", bytes: 512 })
        .mockRejectedValueOnce(new NetworkError("timeout")),
    } as unknown as ArxivClient;
    const { out, err, io } = sink();
    const code = await runDownload(
      client,
      ["1706.03762", "2310.06825", "9999.99999"],
      {},
      io,
    );
    // first failure was NotFoundError → exit code 2
    expect(code).toBe(2);
    // second id succeeded
    expect(out.join("")).toContain("/papers/2310.06825.pdf");
    // both failed ids reported to stderr
    expect(err.join("")).toContain("1706.03762");
    expect(err.join("")).toContain("9999.99999");
  });

  it("continues on error in --json mode, emits error JSON to stderr and success JSON to stdout", async () => {
    const client = {
      download: vi.fn()
        .mockRejectedValueOnce(new NotFoundError("not found"))
        .mockResolvedValueOnce({ path: "/papers/2310.06825.pdf", bytes: 512 }),
    } as unknown as ArxivClient;
    const { out, err, io } = sink();
    const code = await runDownload(
      client,
      ["1706.03762", "2310.06825"],
      { json: true },
      io,
    );
    expect(code).toBe(2); // first failure NotFoundError
    const successJson = JSON.parse(out.join(""));
    expect(successJson.path).toBe("/papers/2310.06825.pdf");
    const errorJson = JSON.parse(err.join(""));
    expect(errorJson.error.id).toBe("1706.03762");
    expect(errorJson.error.code).toBe("NOT_FOUND");
  });

  it("returns 0 when all ids succeed", async () => {
    const client = {
      download: vi.fn().mockResolvedValue({ path: "/p/1706.03762.pdf", bytes: 1 }),
    } as unknown as ArxivClient;
    const { io } = sink();
    expect(await runDownload(client, ["1706.03762"], {}, io)).toBe(0);
  });
});
