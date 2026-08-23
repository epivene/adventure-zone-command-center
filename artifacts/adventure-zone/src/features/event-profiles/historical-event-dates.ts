export type HistoricalEventDate = {
  dateText: string;
  sourceNote: string;
};

const labeledDateLine = /^\s*(?:event\s+dates?|dates?)\s*[:\-]\s*(.*)\s*$/i;
const labeledDateHeader = /^\s*(?:event\s+dates?|dates?)\s*[:\-]?\s*$/i;
const monthDate = /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?(?:\s*[-–]\s*\d{1,2}(?:st|nd|rd|th)?)?(?:,?\s+\d{2,4})\b/i;
const numericDate = /\b\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}\b/;

function looksLikeDate(value: string) {
  return monthDate.test(value) || numericDate.test(value);
}

function normalizedKey(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export function extractHistoricalEventDates(notes: string[]): HistoricalEventDate[] {
  const seen = new Set<string>();
  const results: HistoricalEventDate[] = [];

  for (const sourceNote of notes) {
    const lines = sourceNote.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? "";
      const inline = line.match(labeledDateLine);
      let dateText = inline?.[1]?.trim() ?? "";

      if (!dateText && labeledDateHeader.test(line)) {
        dateText = (lines[index + 1] ?? "").trim();
      }

      if (!dateText || !looksLikeDate(dateText)) continue;
      const key = normalizedKey(dateText);
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({ dateText, sourceNote });
    }
  }

  return results;
}
