export type CalendarPackageReservation = { calendarEventId: string; iCalUid: string | null; occupiedWindow: { startDate: string; endDate: string }; packages: Array<{ packageKey: string; quantity: number }>; confidence: "explicit" | "ambiguous"; evidence: string[]; };
const packages = [{ key: "foam-party", name: "Foam Party" }, { key: "glow-zone", name: "Glow Zone" }] as const;
export function classifyCalendarBooking(input: { summary: string; description: string }) {
 const found = new Map<string, number>(); const evidence: string[] = [];
 for (const item of packages) {
  const expression = new RegExp(`(?:^|[^a-z])(?:(\\d+)\\s+)?${item.name.replace(" ", "\\s+")}(?:\\s+(?:package|packages))?(?=$|[^a-z])`, "ig");
  const titleMatches = [...(input.summary || "").matchAll(expression)]; const matches = titleMatches.length ? titleMatches : [...(input.description || "").matchAll(expression)]; const source = titleMatches.length ? "title" : "description";
  for (const match of matches) { const quantity = Number(match[1] || 1); if (Number.isInteger(quantity) && quantity > 0) { found.set(item.key, (found.get(item.key) || 0) + quantity); evidence.push(`${source}: ${match[1] ? `${match[1]} ` : ""}${item.name}`); } }
 }
 if (found.size) return { confidence: "explicit" as const, packages: [...found].map(([packageKey, quantity]) => ({ packageKey, quantity })), evidence };
 const ambiguous = `${input.summary || ""}\n${input.description || ""}`.match(/\b(foam\s+or\s+glow|foam|glow)\b/i)?.[1];
 return { confidence: "ambiguous" as const, packages: [], evidence: [ambiguous ? `ambiguous package reference: ${ambiguous.toLowerCase()}` : "no explicit package evidence"] };
}