export type CalendarPackageReservation = { calendarEventId: string; iCalUid: string | null; occupiedWindow: { startDate: string; endDate: string }; packages: Array<{ packageKey: string; quantity: number }>; confidence: "explicit" | "ambiguous"; evidence: string[] };
const packages = [{ key: "foam-party", name: "Foam Party" }, { key: "glow-zone", name: "Glow Zone" }] as const;
const uncertainty = /\b(maybe|likely|possibly|tbd|to be determined|tentative|no|not|without|cancel(?:led)?|or)\b/i;
export function classifyCalendarBooking(input: { summary: string; description: string }) {
 const text = [input.summary || "", input.description || ""].join("\n"); const found = new Map<string, Set<number>>(); const evidence = new Map<string, string>();
 for (const item of packages) {
  const mentions = [...text.matchAll(new RegExp(`(?:^|[^a-z0-9])(\\d+)?\\s*${item.name.replace(" ", "\\s+")}(?:\\s+packages?)?(?=$|[^a-z0-9])`, "ig"))];
  if (!mentions.length) continue;
  if (uncertainty.test(text)) return { confidence: "ambiguous" as const, packages: [], evidence: ["ambiguous or conditional package evidence"] };
  for (const match of mentions) {
   const quantity = match[1] ? Number(match[1]) : NaN;
   if (!Number.isInteger(quantity) || quantity < 1) return { confidence: "ambiguous" as const, packages: [], evidence: [`missing explicit quantity: ${item.name}`] };
   const quantities = found.get(item.key) ?? new Set<number>(); quantities.add(quantity); found.set(item.key, quantities);
   evidence.set(`${item.key}:${quantity}`, `explicit quantity: ${quantity} ${item.name}`);
  }
 }
 if (!found.size) return { confidence: "ambiguous" as const, packages: [], evidence: ["no explicit package evidence"] };
 if ([...found.values()].some((quantities) => quantities.size !== 1)) return { confidence: "ambiguous" as const, packages: [], evidence: ["conflicting explicit package quantities"] };
 return { confidence: "explicit" as const, packages: [...found].map(([packageKey, quantities]) => ({ packageKey, quantity: [...quantities][0]! })), evidence: [...evidence.values()] };
}