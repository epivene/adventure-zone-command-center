export type EventFamilyCandidate = {
  id: string;
  name: string;
  placeType: string | null;
  city: string | null;
  region: string | null;
  eventFamilyId?: string | null;
};

export type EventFamilyProposal = {
  proposedName: string;
  normalizedName: string;
  candidateIds: string[];
  source: "rule" | "ai";
  confidence: number;
  reason: string;
};

type EventFamilyRule = {
  name: string;
  normalizedName: string;
  aliases: readonly RegExp[];
};

const EVENT_FAMILY_RULES: readonly EventFamilyRule[] = [
  {
    name: "Fourth of July",
    normalizedName: "fourth of july",
    aliases: [/\b(?:4th|fourth)\s+of\s+july\b/i, /\bindependence\s+day\b/i],
  },
  {
    name: "Oktoberfest",
    normalizedName: "oktoberfest",
    aliases: [/\boktoberfest\b/i, /\boctoberfest\b/i],
  },
  {
    name: "Christmas & Holiday Events",
    normalizedName: "christmas and holiday events",
    aliases: [
      /\bchristmas\s+(?:festival|parade|celebration|market)\b/i,
      /\bholiday\s+(?:festival|parade|celebration|market)\b/i,
    ],
  },
  {
    name: "Fall & Harvest Festivals",
    normalizedName: "fall and harvest festivals",
    aliases: [/\bfall\s+festival\b/i, /\bharvest\s+festival\b/i],
  },
] as const;

export function normalizeFamilyName(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function classifyName(name: string): Pick<EventFamilyProposal, "proposedName" | "normalizedName"> | null {
  const rule = EVENT_FAMILY_RULES.find((candidate) =>
    candidate.aliases.some((alias) => alias.test(name)),
  );
  return rule
    ? { proposedName: rule.name, normalizedName: rule.normalizedName }
    : null;
}

export function classifyObviousEventFamilies(
  records: readonly EventFamilyCandidate[],
): EventFamilyProposal[] {
  const grouped = new Map<string, { rule: EventFamilyRule; ids: Set<string> }>();

  for (const record of records) {
    if (record.eventFamilyId) continue;
    const rule = EVENT_FAMILY_RULES.find((candidate) =>
      candidate.aliases.some((alias) => alias.test(record.name)),
    );
    if (!rule) continue;
    const current = grouped.get(rule.normalizedName) ?? { rule, ids: new Set<string>() };
    current.ids.add(record.id);
    grouped.set(rule.normalizedName, current);
  }

  return [...grouped.values()]
    .filter(({ ids }) => ids.size >= 2)
    .map(({ rule, ids }) => ({
      proposedName: rule.name,
      normalizedName: rule.normalizedName,
      candidateIds: [...ids].sort((left, right) => left.localeCompare(right, "en-US")),
      source: "rule" as const,
      confidence: 1,
      reason: "Names match a reviewed recurring-event alias rule",
    }));
}
