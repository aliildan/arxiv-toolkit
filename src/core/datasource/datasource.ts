export interface DataSource {
  /** GET an Atom feed (the /api/query endpoint); returns the XML text. */
  query(url: string): Promise<string>;
  /** GET an HTML page; resolves to `null` on HTTP 404 (drives the source-fallback matrix). */
  getHtml(url: string): Promise<string | null>;
  /** GET PDF bytes; throws NotFoundError on 404. */
  getPdf(url: string): Promise<Uint8Array>;
  /** GET arbitrary text (e.g. the bibtex endpoint); throws NotFoundError on 404. */
  getText(url: string): Promise<string>;
}
