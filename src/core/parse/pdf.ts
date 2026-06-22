import { extractText, getDocumentProxy } from "unpdf";
import type { Section } from "../types.js";

const WARNING = "PDF text extraction: single-section, no heading heuristics";

/**
 * Clean raw extracted PDF text: join conservative line-break hyphenation
 * (lowercase-hyphen-newline-lowercase), then collapse all whitespace runs to a
 * single space and trim. v1 does not preserve paragraph structure.
 */
export function cleanupText(raw: string): string {
  const dehyphenated = raw.replace(/([a-z])-\n([a-z])/g, "$1$2");
  return dehyphenated.replace(/\s+/g, " ").trim();
}

export async function parsePdf(
  bytes: Uint8Array,
): Promise<{ title?: string; sections: Section[]; warning: string }> {
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: true });
  const content = cleanupText(Array.isArray(text) ? (text as string[]).join(" ") : text);
  const sections: Section[] = [{ title: "Full text", level: 1, content }];
  return { title: undefined, sections, warning: WARNING };
}
