export function buildProfileSearchTerms(value: string): string[] {
  const normalized = value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  if (!normalized) return [];
  return [...new Set(normalized.split(/\s+/).filter(Boolean))];
}
