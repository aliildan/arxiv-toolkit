import type { DataSource } from "./datasource.js";
import { UnsupportedError, NetworkError, NotFoundError } from "../errors.js";

export type BrowserLauncher = {
  launch(options?: { headless?: boolean }): Promise<BrowserInstance>;
};

type BrowserInstance = {
  newPage(): Promise<PageInstance>;
  close(): Promise<void>;
};

type PageInstance = {
  goto(
    url: string,
    options?: { waitUntil?: string },
  ): Promise<{ status(): number } | null>;
  content(): Promise<string>;
  pdf(): Promise<Buffer>;
  close(): Promise<void>;
};

export type PlaywrightImporter = () => Promise<{ chromium: BrowserLauncher }>;

export interface BrowserDataSourceOptions {
  importer?: PlaywrightImporter;
}

const INSTALL_GUIDANCE =
  "The browser fallback is optional and not installed by default. Enable it with:\n" +
  "  npm i -g playwright-core   (or add playwright-core to your project)\n" +
  "  npx playwright install chromium\n" +
  "Then re-run with --browser or ARXIV_BROWSER=1.";

async function loadChromium(importer?: PlaywrightImporter): Promise<BrowserLauncher> {
  const doImport =
    importer ?? (async () => import("playwright-core") as Promise<{ chromium: BrowserLauncher }>);
  try {
    const pw = await doImport();
    return pw.chromium;
  } catch (err) {
    throw new UnsupportedError(
      `playwright-core is not available or no browser binary is installed. ${INSTALL_GUIDANCE}\n(Original error: ${String(err)})`,
    );
  }
}

async function withPage<T>(
  chromium: BrowserLauncher,
  fn: (page: PageInstance) => Promise<T>,
): Promise<T> {
  const browser = await chromium.launch({ headless: true }).catch((err: unknown) => {
    throw new UnsupportedError(`${INSTALL_GUIDANCE}\n(Original error: ${String(err)})`);
  });
  const page = await browser.newPage();
  try {
    return await fn(page);
  } finally {
    await page.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

export class BrowserDataSource implements DataSource {
  private readonly importer?: PlaywrightImporter;
  private launcher?: BrowserLauncher;

  constructor(opts?: BrowserDataSourceOptions) {
    this.importer = opts?.importer;
  }

  /**
   * Returns a cached BrowserLauncher, loading it on first use.
   * A failed load is NOT cached (next call will retry).
   */
  private async getLauncher(): Promise<BrowserLauncher> {
    if (!this.launcher) {
      // loadChromium throws UnsupportedError on failure — do not cache failures
      this.launcher = await loadChromium(this.importer);
    }
    return this.launcher;
  }

  async query(url: string): Promise<string> {
    const chromium = await this.getLauncher();
    return withPage(chromium, async (page) => {
      const resp = await page.goto(url, { waitUntil: "networkidle" });
      if (!resp) throw new NetworkError(`Browser navigation returned no response for ${url}`);
      const status = resp.status();
      if (status >= 400) {
        throw new NetworkError(`Browser got HTTP ${status} for ${url}`);
      }
      return page.content();
    });
  }

  async getHtml(url: string): Promise<string | null> {
    const chromium = await this.getLauncher();
    return withPage(chromium, async (page) => {
      const resp = await page.goto(url, { waitUntil: "networkidle" });
      if (!resp) throw new NetworkError(`Browser navigation returned no response for ${url}`);
      const status = resp.status();
      if (status === 404) return null;
      if (status >= 400) {
        throw new NetworkError(`Browser got HTTP ${status} for ${url}`);
      }
      return page.content();
    });
  }

  async getPdf(url: string): Promise<Uint8Array> {
    const chromium = await this.getLauncher();
    return withPage(chromium, async (page) => {
      const resp = await page.goto(url, { waitUntil: "networkidle" });
      if (!resp) throw new NetworkError(`Browser navigation returned no response for ${url}`);
      const status = resp.status();
      if (status === 404) throw new NotFoundError(`Not found via browser: ${url}`);
      if (status >= 400) {
        throw new NetworkError(`Browser got HTTP ${status} for ${url}`);
      }
      const buf = await page.pdf();
      return new Uint8Array(buf);
    });
  }

  async getText(url: string): Promise<string> {
    const chromium = await this.getLauncher();
    return withPage(chromium, async (page) => {
      const resp = await page.goto(url, { waitUntil: "networkidle" });
      if (!resp) throw new NetworkError(`Browser navigation returned no response for ${url}`);
      const status = resp.status();
      if (status === 404) throw new NotFoundError(`Not found via browser: ${url}`);
      if (status >= 400) {
        throw new NetworkError(`Browser got HTTP ${status} for ${url}`);
      }
      return page.content();
    });
  }
}
