import { describe, it, expect, vi } from "vitest";
import { BrowserDataSource } from "../../../src/core/datasource/browser.js";
import { UnsupportedError } from "../../../src/core/errors.js";

const FIXTURE_HTML = "<html><body><h1>Test Paper</h1></body></html>";
const FIXTURE_PDF = new Uint8Array([37, 80, 68, 70, 45]); // %PDF-

function makeFakeLauncher(
  html: string,
  pdfBytes: Uint8Array,
  status = 200,
): { chromium: import("../../../src/core/datasource/browser.js").BrowserLauncher; fakePage: { close: ReturnType<typeof vi.fn>; content: ReturnType<typeof vi.fn>; pdf: ReturnType<typeof vi.fn>; goto: ReturnType<typeof vi.fn> }; fakeBrowser: { close: ReturnType<typeof vi.fn>; newPage: ReturnType<typeof vi.fn> } } {
  const fakePage = {
    goto: vi.fn().mockResolvedValue({ status: () => status }),
    content: vi.fn().mockResolvedValue(html),
    pdf: vi.fn().mockResolvedValue(Buffer.from(pdfBytes)),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const fakeBrowser = {
    newPage: vi.fn().mockResolvedValue(fakePage),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const chromium = { launch: vi.fn().mockResolvedValue(fakeBrowser) };
  return { chromium, fakePage, fakeBrowser };
}

describe("BrowserDataSource", () => {
  it("getHtml returns rendered HTML on 200", async () => {
    const { chromium } = makeFakeLauncher(FIXTURE_HTML, FIXTURE_PDF);
    const importer = async () => ({ chromium });
    const ds = new BrowserDataSource({ importer });
    const html = await ds.getHtml("https://arxiv.org/html/2310.06825");
    expect(html).toBe(FIXTURE_HTML);
  });

  it("getHtml returns null on 404", async () => {
    const { chromium } = makeFakeLauncher(FIXTURE_HTML, FIXTURE_PDF, 404);
    const importer = async () => ({ chromium });
    const ds = new BrowserDataSource({ importer });
    const html = await ds.getHtml("https://arxiv.org/html/0000.00000");
    expect(html).toBeNull();
  });

  it("query returns page content string", async () => {
    const { chromium } = makeFakeLauncher(FIXTURE_HTML, FIXTURE_PDF);
    const importer = async () => ({ chromium });
    const ds = new BrowserDataSource({ importer });
    const text = await ds.query("https://export.arxiv.org/api/query?search_query=all:test");
    expect(text).toBe(FIXTURE_HTML);
  });

  it("getText returns page content string", async () => {
    const { chromium } = makeFakeLauncher(FIXTURE_HTML, FIXTURE_PDF);
    const importer = async () => ({ chromium });
    const ds = new BrowserDataSource({ importer });
    const text = await ds.getText("https://arxiv.org/bibtex/2310.06825");
    expect(text).toBe(FIXTURE_HTML);
  });

  it("getPdf returns Uint8Array of page PDF bytes", async () => {
    const { chromium } = makeFakeLauncher(FIXTURE_HTML, FIXTURE_PDF);
    const importer = async () => ({ chromium });
    const ds = new BrowserDataSource({ importer });
    const bytes = await ds.getPdf("https://arxiv.org/pdf/2310.06825.pdf");
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(Array.from(bytes)).toEqual(Array.from(FIXTURE_PDF));
  });

  it("throws UnsupportedError with install guidance when playwright-core is missing", async () => {
    const failingImporter = async () => {
      throw Object.assign(new Error("Cannot find module 'playwright-core'"), {
        code: "MODULE_NOT_FOUND",
      });
    };
    const ds = new BrowserDataSource({ importer: failingImporter });
    await expect(ds.getHtml("https://arxiv.org/html/2310.06825")).rejects.toMatchObject({
      code: "UNSUPPORTED",
      message: expect.stringContaining("playwright install chromium"),
    });
  });

  it("browser and page are closed after a successful call", async () => {
    const { chromium, fakeBrowser, fakePage } = makeFakeLauncher(FIXTURE_HTML, FIXTURE_PDF);
    const importer = async () => ({ chromium });
    const ds = new BrowserDataSource({ importer });
    await ds.getHtml("https://arxiv.org/html/2310.06825");
    expect(fakePage.close).toHaveBeenCalledTimes(1);
    expect(fakeBrowser.close).toHaveBeenCalledTimes(1);
  });
});
