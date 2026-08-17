const namedEntities: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntity(entity: string): string {
  const lower = entity.toLowerCase();
  if (lower.startsWith("#x")) {
    const codePoint = Number.parseInt(lower.slice(2), 16);
    if (Number.isFinite(codePoint)) {
      try {
        return String.fromCodePoint(codePoint);
      } catch {
        return `&${entity};`;
      }
    }
  }
  if (lower.startsWith("#")) {
    const codePoint = Number.parseInt(lower.slice(1), 10);
    if (Number.isFinite(codePoint)) {
      try {
        return String.fromCodePoint(codePoint);
      } catch {
        return `&${entity};`;
      }
    }
  }
  return namedEntities[lower] ?? `&${entity};`;
}

/** Safely display legacy ACT/Gmail HTML as text without rendering imported HTML. */
export function actHtmlToPlainText(value: string): string {
  if (!/<\/?[a-z][\s\S]*?>/i.test(value)) return value;

  return value
    .replace(/<\s*(script|style)\b[^>]*>[\s\S]*?<\/\s*\1\s*>/gi, "")
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\s*li\b[^>]*>/gi, "• ")
    .replace(/<\/\s*(?:p|div|li|ul|ol|tr|table|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_match, entity: string) => decodeEntity(entity))
    .replace(/\u00a0/g, " ")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
