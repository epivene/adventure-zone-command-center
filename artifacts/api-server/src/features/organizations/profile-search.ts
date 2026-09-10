function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function buildProfileSearchTerms(value: string): string[] {
  const normalized = normalizeSearchText(value);

  if (!normalized) return [];
  return [...new Set(normalized.split(/\s+/).filter(Boolean))];
}

function maximumTypoDistance(term: string): number {
  if (term.length < 3) return 0;
  if (term.length < 6) return 1;
  return 2;
}

function editDistanceWithin(left: string, right: string, maximum: number): boolean {
  if (Math.abs(left.length - right.length) > maximum) return false;

  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    const current = [leftIndex + 1];
    let rowMinimum = current[0];
    for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
      const cost = left[leftIndex] === right[rightIndex] ? 0 : 1;
      const value = Math.min(
        current[rightIndex] + 1,
        previous[rightIndex + 1] + 1,
        previous[rightIndex] + cost,
      );
      current.push(value);
      rowMinimum = Math.min(rowMinimum, value);
    }
    if (rowMinimum > maximum) return false;
    previous = current;
  }
  return previous[right.length] <= maximum;
}

export function profileSearchTermMatches(term: string, value: string): boolean {
  const normalizedTerm = normalizeSearchText(term).replace(/\s+/g, "");
  const normalizedValue = normalizeSearchText(value);
  if (!normalizedTerm || !normalizedValue) return false;

  const compactValue = normalizedValue.replace(/\s+/g, "");
  if (compactValue.includes(normalizedTerm)) return true;

  const maximum = maximumTypoDistance(normalizedTerm);
  if (!maximum) return false;

  return normalizedValue
    .split(/\s+/)
    .some((word) => editDistanceWithin(normalizedTerm, word, maximum));
}

export function profileSearchMatches(terms: string[], values: string[]): boolean {
  return terms.every((term) => values.some((value) => profileSearchTermMatches(term, value)));
}

function profileSearchTermScore(term: string, value: string): number | null {
  const normalizedTerm = normalizeSearchText(term).replace(/\s+/g, "");
  const normalizedValue = normalizeSearchText(value);
  if (!normalizedTerm || !normalizedValue) return null;

  const words = normalizedValue.split(/\s+/);
  if (words.includes(normalizedTerm)) return 0;
  if (normalizedValue.replace(/\s+/g, "").includes(normalizedTerm)) return 1;
  return profileSearchTermMatches(normalizedTerm, normalizedValue) ? 10 : null;
}

export function profileSearchScore(terms: string[], values: string[]): number | null {
  let total = 0;
  for (const term of terms) {
    const scores = values
      .map((value) => profileSearchTermScore(term, value))
      .filter((score): score is number => score !== null);
    if (!scores.length) return null;
    total += Math.min(...scores);
  }
  return total;
}
