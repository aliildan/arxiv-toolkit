import { NotFoundError, RateLimitedError, NetworkError } from "./errors.js";
import type { ArxivConfig } from "./types.js";
import type { RateLimiter } from "./rate-limit.js";
import type { Cache } from "./cache.js";

const hostnameOf = (url: string): string => new URL(url).hostname;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export const MAX_RETRIES = 3;
export const BASE_BACKOFF_MS = 500;

const isRetryableStatus = (status: number): boolean => status === 429 || (status >= 500 && status < 600);

const retryAfterMs = (res: Response): number | null => {
  const ra = res.headers.get("retry-after");
  if (!ra) return null;
  const seconds = Number(ra);
  if (Number.isFinite(seconds)) return seconds * 1000;
  const date = Date.parse(ra);
  return Number.isNaN(date) ? null : date - Date.now();
};

const backoffMs = (attempt: number): number => {
  const base = BASE_BACKOFF_MS * 2 ** attempt;
  const jitter = Math.floor(Math.random() * 250);
  return base + jitter;
};

export class Http {
  private readonly cfg: ArxivConfig;
  private readonly limiter: RateLimiter;
  private readonly cache?: Cache;

  constructor(cfg: ArxivConfig, limiter: RateLimiter, cache?: Cache) {
    this.cfg = cfg;
    this.limiter = limiter;
    this.cache = cache;
  }

  private async fetchWithRetry(url: string, accept: string): Promise<Response> {
    let lastResponse: Response | null = null;
    let lastError: unknown = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      await this.limiter.acquire(hostnameOf(url));
      try {
        const res = await fetch(url, {
          method: "GET",
          headers: { "User-Agent": this.cfg.userAgent, Accept: accept },
        });
        if (!isRetryableStatus(res.status)) {
          return res;
        }
        lastResponse = res;
        if (attempt === MAX_RETRIES) break;
        const ra = retryAfterMs(res);
        const delay = ra !== null && ra > 0 ? ra : backoffMs(attempt);
        await sleep(delay);
      } catch (err) {
        lastError = err;
        lastResponse = null;
        if (attempt === MAX_RETRIES) break;
        await sleep(backoffMs(attempt));
      }
    }
    if (lastResponse) {
      if (lastResponse.status === 429) {
        throw new RateLimitedError(`Rate limited by ${hostnameOf(url)}`);
      }
      throw new NetworkError(`HTTP ${lastResponse.status} for ${url}`);
    }
    throw new NetworkError(`Network error for ${url}: ${String(lastError)}`);
  }

  async getText(url: string): Promise<string | null> {
    const res = await this.fetchWithRetry(url, "text/plain, application/xml; q=0.9, */*; q=0.5");
    if (res.status === 404) return null;
    if (!res.ok) throw new NetworkError(`HTTP ${res.status} for ${url}`);
    return res.text();
  }

  async getBytes(url: string): Promise<Uint8Array> {
    const res = await this.fetchWithRetry(url, "application/pdf, */*; q=0.5");
    if (res.status === 404) throw new NotFoundError(`Not found: ${url}`);
    if (!res.ok) throw new NetworkError(`HTTP ${res.status} for ${url}`);
    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  }
}
