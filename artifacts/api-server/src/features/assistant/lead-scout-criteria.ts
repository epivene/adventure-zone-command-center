import type {
  LeadDiscoveryCriteria,
  LeadDiscoveryInterpretation,
} from "./lead-scout-types";

const stateNames: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS",
  kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA",
  michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT",
  nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ",
  "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND",
  ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI",
  "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT",
  vermont: "VT", virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
};

const stateLabels = Object.fromEntries(
  Object.entries(stateNames).map(([label, code]) => [code, label.replace(/\b\w/g, (letter) => letter.toUpperCase())]),
) as Record<string, string>;

const monthNumbers: Record<string, number> = {
  january: 1, jan: 1,
  february: 2, feb: 2,
  march: 3, mar: 3,
  april: 4, apr: 4,
  may: 5,
  june: 6, jun: 6,
  july: 7, jul: 7,
  august: 8, aug: 8,
  september: 9, sep: 9, sept: 9,
  october: 10, oct: 10,
  november: 11, nov: 11,
  december: 12, dec: 12,
};

const monthLabels = [
  "", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const corridorBridges = new Map<string, string[]>([
  ["MT:UT", ["MT", "ID", "WY", "UT"]],
  ["UT:MT", ["UT", "WY", "ID", "MT"]],
]);

const eventKeywordPatterns: Array<[RegExp, string]> = [
  [/\bfairs?\b/i, "fair"],
  [/\bfestivals?\b/i, "festival"],
  [/\bfamily\b/i, "family"],
  [/\bparades?\b/i, "parade"],
  [/\bcelebrations?\b/i, "celebration"],
  [/\bcarnivals?\b/i, "carnival"],
  [/\bcommunity\b/i, "community"],
  [/\brodeos?\b/i, "rodeo"],
  [/\bmarkets?\b/i, "market"],
  [/\bschools?\b/i, "school"],
  [/\bcolleges?|universit(?:y|ies)\b/i, "college"],
  [/\bholiday\b/i, "holiday"],
];

function isoDate(year: number, month: number, day: number) {
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function validDateParts(year: number, month: number, day: number) {
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1) return false;
  return day <= daysInMonth(year, month);
}

type DateParts = { year: number; month: number; day: number };

function parseNamedDates(text: string): DateParts[] {
  const names = Object.keys(monthNumbers)
    .sort((left, right) => right.length - left.length)
    .join("|");
  const expression = new RegExp(`\\b(${names})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s*,?\\s*(20\\d{2})\\b`, "gi");
  const dates: DateParts[] = [];
  for (const match of text.matchAll(expression)) {
    const month = monthNumbers[(match[1] ?? "").toLowerCase()];
    const day = Number(match[2]);
    const year = Number(match[3]);
    if (month && validDateParts(year, month, day)) dates.push({ year, month, day });
  }
  return dates;
}

function parseIsoDates(text: string): DateParts[] {
  const dates: DateParts[] = [];
  for (const match of text.matchAll(/\b(20\d{2})-(\d{2})-(\d{2})\b/g)) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (validDateParts(year, month, day)) dates.push({ year, month, day });
  }
  return dates;
}

function dateRange(text: string) {
  const dates = [...parseIsoDates(text), ...parseNamedDates(text)];
  if (dates.length >= 2) {
    const sorted = dates
      .map((parts) => ({ ...parts, key: isoDate(parts.year, parts.month, parts.day) }))
      .sort((left, right) => left.key.localeCompare(right.key));
    return {
      dateFrom: sorted[0]!.key,
      dateThrough: sorted[sorted.length - 1]!.key,
      year: sorted[0]!.year === sorted[sorted.length - 1]!.year ? sorted[0]!.year : null,
      month: sorted[0]!.month === sorted[sorted.length - 1]!.month && sorted[0]!.year === sorted[sorted.length - 1]!.year
        ? sorted[0]!.month
        : null,
    };
  }

  const monthMatch = text.match(/\b(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)\b/i);
  const yearMatch = text.match(/\b(20\d{2})\b/);
  const month = monthMatch ? monthNumbers[monthMatch[1]!.toLowerCase()] ?? null : null;
  const year = yearMatch ? Number(yearMatch[1]) : null;
  if (month && year) {
    return {
      dateFrom: isoDate(year, month, 1),
      dateThrough: isoDate(year, month, daysInMonth(year, month)),
      month,
      year,
    };
  }
  return { dateFrom: null, dateThrough: null, month, year };
}

function findStates(text: string) {
  const lower = text.toLowerCase();
  const hits: Array<{ code: string; start: number; end: number }> = [];
  for (const [name, code] of Object.entries(stateNames)) {
    const escaped = name.replace(/\s+/g, "\\s+");
    const match = new RegExp(`\\b${escaped}\\b`, "i").exec(lower);
    if (match) hits.push({ code, start: match.index, end: match.index + match[0].length });
  }
  for (const code of Object.values(stateNames)) {
    const match = new RegExp(`\\b${code}\\b`).exec(text.toUpperCase());
    if (match && !hits.some((hit) => hit.code === code)) hits.push({ code, start: match.index, end: match.index + match[0].length });
  }
  return hits.sort((left, right) => left.start - right.start);
}

function geography(text: string) {
  const leg = text.match(/\bleg\s*(\d{1,2})\b/i)?.[1] ?? null;
  if (leg) {
    return {
      geoMode: "route" as const,
      routeId: null,
      legId: leg,
      regions: [] as string[],
      cities: [] as string[],
    };
  }

  const states = findStates(text);
  const between = /\bbetween\b/i.test(text) && /\band\b/i.test(text) && states.length >= 2;
  if (between) {
    const from = states[0]!.code;
    const to = states[1]!.code;
    return {
      geoMode: "corridor" as const,
      routeId: null,
      legId: null,
      regions: corridorBridges.get(`${from}:${to}`) ?? [from, to],
      cities: [] as string[],
    };
  }

  const regions = [...new Set(states.map((state) => state.code))];
  if (regions.length) {
    return {
      geoMode: "regions" as const,
      routeId: null,
      legId: null,
      regions,
      cities: [] as string[],
    };
  }

  if (/\b(on|along|near)\s+(the\s+)?route\b/i.test(text)) {
    return {
      geoMode: "route" as const,
      routeId: null,
      legId: null,
      regions: [] as string[],
      cities: [] as string[],
    };
  }

  return {
    geoMode: "unspecified" as const,
    routeId: null,
    legId: null,
    regions: [] as string[],
    cities: [] as string[],
  };
}

function fitIntent(text: string): LeadDiscoveryCriteria["fitIntent"] {
  const vendor = /\b(vendor|exhibitor|booth|sponsor(?:ship)?)\b/i.test(text);
  const booking = /\b(book(?:ed|ing)?|hire|entertainment|perform|provide|bring adventure zone)\b/i.test(text);
  if (vendor && booking) return "either";
  if (vendor) return "vendor_opportunity";
  if (booking) return "bookable_event";
  return "either";
}

function eventKeywords(text: string) {
  return eventKeywordPatterns
    .filter(([pattern]) => pattern.test(text))
    .map(([, keyword]) => keyword);
}

function prettyDateRange(criteria: LeadDiscoveryCriteria) {
  if (!criteria.dateFrom || !criteria.dateThrough) return "Date not confirmed";
  if (criteria.month && criteria.year) {
    const startDay = Number(criteria.dateFrom.slice(-2));
    const endDay = Number(criteria.dateThrough.slice(-2));
    return `${monthLabels[criteria.month]} ${startDay}–${endDay}, ${criteria.year}`;
  }
  return `${criteria.dateFrom} through ${criteria.dateThrough}`;
}

function prettyGeography(criteria: LeadDiscoveryCriteria) {
  if (criteria.legId) return `Leg ${criteria.legId}`;
  if (criteria.geoMode === "corridor" && criteria.regions.length >= 2) {
    const first = stateLabels[criteria.regions[0]!] ?? criteria.regions[0];
    const last = stateLabels[criteria.regions[criteria.regions.length - 1]!] ?? criteria.regions[criteria.regions.length - 1];
    return `${first}-to-${last} corridor`;
  }
  if (criteria.regions.length) return criteria.regions.map((code) => stateLabels[code] ?? code).join(", ");
  if (criteria.geoMode === "route") return "route area";
  return "Location not confirmed";
}

function hasDiscoveryLanguage(text: string) {
  return /\b(find|search|look for|need|event|fair|festival|vendor|lead|opportunit|book|route|leg)\b/i.test(text);
}

export function interpretLeadDiscoveryCriteria(
  question: string,
  _now: Date = new Date(),
): LeadDiscoveryInterpretation {
  const originalQuestion = question.trim();
  const dates = dateRange(originalQuestion);
  const geo = geography(originalQuestion);
  const partial: Partial<LeadDiscoveryCriteria> = {
    originalQuestion,
    ...dates,
    ...geo,
    eventKeywords: eventKeywords(originalQuestion),
    fitIntent: fitIntent(originalQuestion),
  };

  if (!hasDiscoveryLanguage(originalQuestion)) {
    return {
      kind: "needs_clarification",
      message: "Tell me what kind of event or booking opportunity you want me to find.",
      partial,
    };
  }

  if (!dates.dateFrom || !dates.dateThrough) {
    return {
      kind: "needs_clarification",
      message: dates.month && !dates.year
        ? "What year should I use for that month or season?"
        : "What date, month, or date range should I search?",
      partial,
    };
  }

  if (geo.geoMode === "unspecified") {
    return {
      kind: "needs_clarification",
      message: "What state, city, route, corridor, or leg should I search around?",
      partial,
    };
  }

  const criteria: LeadDiscoveryCriteria = {
    originalQuestion,
    dateFrom: dates.dateFrom,
    dateThrough: dates.dateThrough,
    month: dates.month,
    year: dates.year,
    regions: geo.regions,
    cities: geo.cities,
    geoMode: geo.geoMode,
    routeId: geo.routeId,
    legId: geo.legId,
    eventKeywords: eventKeywords(originalQuestion),
    fitIntent: fitIntent(originalQuestion),
  };

  return {
    kind: "criteria",
    criteria,
    summary: `${prettyDateRange(criteria)} · ${prettyGeography(criteria)} · ${criteria.fitIntent === "vendor_opportunity" ? "vendor opportunities" : criteria.fitIntent === "bookable_event" ? "bookable entertainment opportunities" : "bookable or vendor opportunities"}`,
  };
}
