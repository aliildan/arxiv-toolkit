import { describe, it, expect, vi } from "vitest";
import { ApiDataSource } from "../../../src/core/datasource/api.js";
import type { Http } from "../../../src/core/http.js";

function fakeHttp(over: Partial<Http> = {}): Http {
  return {
    getText: vi.fn(async () => null),
    getBytes: vi.fn(async () => new Uint8Array()),
    ...over,
  } as unknown as Http;
}

describe("ApiDataSource", () => {
  it("query returns the Atom text from http.getText", async () => {
    const http = fakeHttp({ getText: vi.fn(async () => "<feed/>") as Http["getText"] });
    const ds = new ApiDataSource(http);
    expect(await ds.query("https://export.arxiv.org/api/query?x=1")).toBe("<feed/>");
  });

  it("query throws NetworkError when http.getText returns null (404)", async () => {
    const http = fakeHttp({ getText: vi.fn(async () => null) as Http["getText"] });
    const ds = new ApiDataSource(http);
    await expect(ds.query("https://export.arxiv.org/api/query?x=1")).rejects.toMatchObject({
      code: "NETWORK",
    });
  });

  it("getHtml passes null through on 404", async () => {
    const http = fakeHttp({ getText: vi.fn(async () => null) as Http["getText"] });
    const ds = new ApiDataSource(http);
    expect(await ds.getHtml("https://arxiv.org/html/0000.00000")).toBeNull();
  });

  it("getHtml returns the HTML body on 200", async () => {
    const http = fakeHttp({ getText: vi.fn(async () => "<html/>") as Http["getText"] });
    const ds = new ApiDataSource(http);
    expect(await ds.getHtml("https://arxiv.org/html/2310.06825")).toBe("<html/>");
  });

  it("getPdf delegates to http.getBytes", async () => {
    const bytes = new Uint8Array([37, 80, 68, 70]);
    const http = fakeHttp({ getBytes: vi.fn(async () => bytes) as Http["getBytes"] });
    const ds = new ApiDataSource(http);
    expect(await ds.getPdf("https://arxiv.org/pdf/2310.06825.pdf")).toBe(bytes);
  });

  it("getText returns the text on 200", async () => {
    const http = fakeHttp({ getText: vi.fn(async () => "@misc{...}") as Http["getText"] });
    const ds = new ApiDataSource(http);
    expect(await ds.getText("https://arxiv.org/bibtex/2310.06825")).toBe("@misc{...}");
  });

  it("getText throws NotFoundError when http.getText returns null (404)", async () => {
    const http = fakeHttp({ getText: vi.fn(async () => null) as Http["getText"] });
    const ds = new ApiDataSource(http);
    await expect(ds.getText("https://arxiv.org/bibtex/0000.00000")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
