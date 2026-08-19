export type LeadScoutAttendanceScale = "large" | "medium" | "small" | "unknown";

export function classifyAttendanceScale(value: string | null | undefined): LeadScoutAttendanceScale {
  const text = (value ?? "").toLowerCase();
  if (!text.trim()) return "unknown";

  if (/tens? of thousands|thousands of (?:people|attendees|visitors)|large regional crowd|major public turnout/.test(text)) {
    return "large";
  }

  const match = text.match(/(?:^|\D)(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(k)?\b/i);
  if (!match) return "unknown";
  const raw = Number(match[1]!.replace(/,/g, ""));
  if (!Number.isFinite(raw)) return "unknown";
  const attendance = match[2] ? raw * 1000 : raw;
  if (attendance >= 2_000) return "large";
  if (attendance >= 750) return "medium";
  return "small";
}

export function isAdultSpecialInterestEvent(name: string, eventType: string | null | undefined) {
  const text = `${name} ${eventType ?? ""}`.toLowerCase();
  return /\b(paranormal investigation|ghost hunt|adult(?:s)? only|18\+|21\+|nightlife|bar crawl|pub crawl|wine tasting|beer tasting|casino night|burlesque)\b/.test(text);
}
