export type CalendarPackageReservation = {
  calendarEventId: string;
  iCalUid: string | null;
  occupiedWindow: { startDate: string; endDate: string };
  packages: Array<{ packageKey: string; quantity: number }>;
  confidence: "explicit" | "ambiguous";
  evidence: string[];
};

const packages = [
  { key: "adventure_zone", name: "Adventure Zone", expression: "adventure\\s+zone" },
  { key: "pirates_rebellion", name: "Pirate's Rebellion", expression: "pirate(?:'s|s)?\\s+rebellion" },
  { key: "weekend_warriors", name: "Warrior's Playground", expression: "(?:warrior(?:'s|s)?\\s+playground|weekend\\s+warriors?)" },
  { key: "mini_zone", name: "Mini Zone", expression: "mini\\s+zone" },
  // These remain explicit evidence but are not normal package inventory. The
  // capacity calculator deliberately blocks rather than silently mapping them.
  { key: "foam-party", name: "Foam Party", expression: "foam\\s+party" },
  { key: "glow-zone", name: "Glow Zone", expression: "glow\\s+zone" },
] as const;

const uncertainty = /\b(maybe|likely|possibly|tbd|to be determined|tentative|no|not|without|cancel(?:led)?|or|minus|remove|exclude)\b|[-−]\s*\d+\s*(?:adventure\s+zone|pirate(?:'s|s)?\s+rebellion|warrior(?:'s|s)?\s+playground|weekend\s+warriors?|mini\s+zone|foam\s+party|glow\s+zone)\b/i;

function packageClause(text: string, index: number, length: number) {
  const start = Math.max(text.lastIndexOf("\n", index - 1), text.lastIndexOf(".", index - 1), text.lastIndexOf(";", index - 1)) + 1;
  const ends = [text.indexOf("\n", index + length), text.indexOf(".", index + length), text.indexOf(";", index + length)].filter((value) => value >= 0);
  return text.slice(start, ends.length ? Math.min(...ends) : text.length);
}

export function classifyCalendarBooking(input: { summary: string; description: string }) {
  const text = [input.summary || "", input.description || ""].join("\n");
  const found = new Map<string, Set<number>>();
  const evidence = new Map<string, string>();

  for (const item of packages) {
    const mentions = [...text.matchAll(new RegExp(`(?:^|[^a-z0-9])(\\d+)?\\s*${item.expression}(?:\\s+packages?)?(?=$|[^a-z0-9])`, "ig"))];
    if (!mentions.length) continue;
    for (const match of mentions) {
      if (uncertainty.test(packageClause(text, match.index!, match[0].length))) {
        return { confidence: "ambiguous" as const, packages: [], evidence: ["ambiguous or conditional package evidence"] };
      }
      const clause = packageClause(text, match.index!, match[0].length);
      const hasOtherExplicitPackage = packages.some((candidate) =>
        candidate.key !== item.key &&
        new RegExp(`\\b\\d+\\s+${candidate.expression}\\b`, "i").test(clause),
      );
      const isAdventureZoneBookingPrefix =
        item.key === "adventure_zone" &&
        match.index === 0 &&
        /^adventure\s+zone\s+booking\s*(?:—|–|-|:)\s*/i.test(text);
      if (!match[1] && isAdventureZoneBookingPrefix && hasOtherExplicitPackage) {
        continue;
      }
      const quantity = match[1] ? Number(match[1]) : NaN;
      if (!Number.isInteger(quantity) || quantity < 1) {
        return { confidence: "ambiguous" as const, packages: [], evidence: [`missing explicit quantity: ${item.name}`] };
      }
      const quantities = found.get(item.key) ?? new Set<number>();
      quantities.add(quantity);
      found.set(item.key, quantities);
      evidence.set(`${item.key}:${quantity}`, `explicit quantity: ${quantity} ${item.name}`);
    }
  }

  if (!found.size) return { confidence: "ambiguous" as const, packages: [], evidence: ["no explicit package evidence"] };
  if ([...found.values()].some((quantities) => quantities.size !== 1)) {
    return { confidence: "ambiguous" as const, packages: [], evidence: ["conflicting explicit package quantities"] };
  }
  return {
    confidence: "explicit" as const,
    packages: [...found].map(([packageKey, quantities]) => ({ packageKey, quantity: [...quantities][0]! })),
    evidence: [...evidence.values()],
  };
}
