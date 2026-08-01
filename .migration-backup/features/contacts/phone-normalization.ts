/**
 * Returns the canonical E.164 representation used for exact local caller
 * matching. Extensions are intentionally rejected because they identify a
 * desk, not a caller, and must never broaden a contact match.
 */
export function normalizeNorthAmericanPhone(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/(?:\bext(?:ension)?\.?\s*\d+|\bx\s*\d+)/i.test(trimmed)) {
    return null;
  }

  const digits = trimmed.replace(/\D/g, "");
  if (/^\d{10}$/.test(digits)) return `+1${digits}`;
  if (/^1\d{10}$/.test(digits)) return `+${digits}`;
  return null;
}
