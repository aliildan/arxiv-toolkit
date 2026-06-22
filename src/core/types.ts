export interface Author {
  name: string;
  affiliation?: string;
}

export interface Paper {
  id: string;
  version?: number;
  idWithVersion?: string;
  title: string;
  summary: string;
  authors: Author[];
  categories: string[];
  primaryCategory: string;
  published: string;
  updated: string;
  doi?: string;
  journalRef?: string;
  comment?: string;
  links: { abs: string; pdf: string; html?: string };
}

export interface SearchParams {
  query?: string;
  title?: string;
  author?: string;
  abstract?: string;
  category?: string;
  ids?: string[];
  start?: number;
  maxResults?: number;
  sortBy?: "relevance" | "submittedDate" | "lastUpdatedDate";
  sortOrder?: "ascending" | "descending";
}

export interface SearchResult {
  total: number;
  start: number;
  count: number;
  papers: Paper[];
  hints?: string[];
}

export interface Section {
  id?: string;
  title: string;
  level: number;
  content: string;
}

export interface PaperContent {
  id: string;
  version?: number;
  source: "html-native" | "html-ar5iv" | "pdf";
  format: "markdown" | "text";
  title: string;
  abstract?: string;
  sections: Section[];
  text: string;
  truncated: boolean;
  nextCursor?: string;
  warnings?: string[];
}

export interface ReadOptions {
  source?: "auto" | "html" | "pdf";
  format?: "markdown" | "text";
  section?: string;
  maxChars?: number;
  cursor?: string;
}

export interface DownloadOptions {
  type?: "pdf";
  dir?: string;
}

export interface ArxivConfig {
  cacheDir: string;
  downloadsDir: string;
  configDir: string;
  rateMs: number;
  userAgent: string;
  contact?: string;
  noCache: boolean;
  defaultMaxResults: number;
  browserFallback: boolean;
}

export interface NormalizedId {
  id: string;
  version?: number;
  idWithVersion?: string;
}
