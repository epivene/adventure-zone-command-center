export type LeadScoutAttendanceScale = "large" | "medium" | "small" | "unknown";

export function classifyAttendanceScale(value: string | null | undefined): LeadScoutAttendanceScale {
  const text = (value ?? "").toLowerCase();
  if (!text.trim()) return "unknown";

  if (/tens? of thousands|thousands of (?:people|attendees|visitors)|large regional crowd|major public turnout/.test(text)) {
    return "large";
  }

  const counts: number[] = [];
  const numberPattern = /(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(k)?\b/gi;
  for (const match of text.matchAll(numberPattern)) {
    const rawText = match[1] ?? "";
    const raw = Number(rawText.replace(/,/g, ""));
    if (!Number.isFinite(raw)) continue;
    if (!match[2] && /^\d{4}$/.test(rawText) && raw >= 1900 && raw <= 2100) continue;
    counts.push(match[2] ? raw * 1000 : raw);
  }

  if (!counts.length) return "unknown";
  const attendance = Math.max(...counts);
  if (attendance >= 2_000) return "large";
  if (attendance >= 750) return "medium";
  return "small";
}

export function isAdultSpecialInterestEvent(name: string, eventType: string | null | undefined) {
  const text = `${name} ${eventType ?? ""}`.toLowerCase();
  return /\b(paranormal investigation|ghost hunt|adult(?:s)? only|18\+|21\+|nightlife|bar crawl|pub crawl|wine tasting|beer tasting|wine festival|beer festival|brewfest|brew festival|casino night|burlesque)\b/.test(text);
}
