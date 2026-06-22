import { NetworkError, NotFoundError } from "../errors.js";
import type { Http } from "../http.js";
import type { DataSource } from "./datasource.js";

/**
 * Default DataSource over arXiv's official endpoints. A thin transport: it
 * builds no URLs and parses nothing — the client decides URLs and fallback
 * order; parsing lives in core/parse/*.
 */
export class ApiDataSource implements DataSource {
  private readonly http: Http;

  constructor(http: Http) {
    this.http = http;
  }

  async query(url: string): Promise<string> {
    const text = await this.http.getText(url);
    if (text === null) {
      throw new NetworkError(`Query endpoint returned no body: ${url}`);
    }
    return text;
  }

  async getHtml(url: string): Promise<string | null> {
    return this.http.getText(url);
  }

  async getPdf(url: string): Promise<Uint8Array> {
    return this.http.getBytes(url);
  }

  async getText(url: string): Promise<string> {
    const text = await this.http.getText(url);
    if (text === null) {
      throw new NotFoundError(`Not found: ${url}`);
    }
    return text;
  }
}
