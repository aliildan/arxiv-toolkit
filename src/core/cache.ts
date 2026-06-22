import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";

const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .map((k) => JSON.stringify(k) + ":" + stableStringify((value as Record<string, unknown>)[k]));
  return "{" + entries.join(",") + "}";
};

const hashKey = (key: object): string =>
  createHash("sha256").update(stableStringify(key)).digest("hex").slice(0, 32);

export interface CacheEntryMeta {
  fetchedAt: number;
  ttl: number | null;
  key: unknown;
}

export class Cache {
  private readonly dir: string;
  private readonly disabled: boolean;

  constructor(dir: string, opts?: { disabled?: boolean }) {
    this.dir = dir;
    this.disabled = opts?.disabled ?? false;
  }

  path(): string {
    return this.dir;
  }

  private async ensureDir(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
  }

  async get<T>(key: object): Promise<T | null> {
    if (this.disabled) return null;
    const h = hashKey(key);
    const dataPath = join(this.dir, `${h}.json`);
    const metaPath = join(this.dir, `${h}.meta.json`);
    let meta: CacheEntryMeta;
    try {
      const metaBuf = await readFile(metaPath, "utf8");
      meta = JSON.parse(metaBuf) as CacheEntryMeta;
    } catch {
      return null; // no sidecar => miss
    }
    // JSON serializes Infinity as null; treat null ttl as Infinity (never expires)
    const ttl = meta.ttl === null ? Infinity : meta.ttl;
    if (ttl !== Infinity && Date.now() - meta.fetchedAt > ttl) {
      return null; // expired
    }
    try {
      const dataBuf = await readFile(dataPath, "utf8");
      return JSON.parse(dataBuf) as T;
    } catch {
      return null;
    }
  }

  async set(key: object, value: unknown, ttlMs: number): Promise<void> {
    if (this.disabled) return;
    await this.ensureDir();
    const h = hashKey(key);
    const dataPath = join(this.dir, `${h}.json`);
    const metaPath = join(this.dir, `${h}.meta.json`);
    const meta: CacheEntryMeta = { fetchedAt: Date.now(), ttl: ttlMs, key };
    await writeFile(dataPath, JSON.stringify(value), "utf8");
    await writeFile(metaPath, JSON.stringify(meta), "utf8");
  }

  async clear(): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(this.dir);
    } catch {
      return; // dir does not exist yet
    }
    await Promise.all(
      entries.map((name) => rm(join(this.dir, name), { force: true })),
    );
  }
}
