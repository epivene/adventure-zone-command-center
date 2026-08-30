export type OperationalCalendarMatchCandidate = {
  bookingId: string;
  organizationId: string | null;
  name: string;
  organizationName?: string | null;
  actRecordId?: string | null;
  organizationActRecordId?: string | null;
  city: string;
  region: string;
  startsAt: Date | null;
  endsAt: Date | null;
  travelLegName: string | null;
};

export type OperationalMatch =
  | { kind: "matched"; bookingId: string; organizationId: string | null; confidence: "high" | "medium"; score: number }
  | { kind: "review"; candidateBookingIds: string[]; reason: string }
  | { kind: "new" };

function normalize(value: string | null | undefined) {
  return (value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function dateOverlapDays(aStart: Date | null, aEnd: Date | null, bStart: Date | null, bEnd: Date | null) {
  if (!aStart || !bStart) return 0;
  const start = Math.max(aStart.getTime(), bStart.getTime());
  const end = Math.min((aEnd ?? aStart).getTime(), (bEnd ?? bStart).getTime());
  if (end < start) return 0;
  return Math.floor((end - start) / 86_400_000) + 1;
}

function scoreCandidate(input: {
  eventName: string;
  city: string | null;
  region: string | null;
  actualStartsAt: Date | null;
  actualEndsAt: Date | null;
  managerToken: string | null;
}, candidate: OperationalCalendarMatchCandidate) {
  let score = 0;
  const eventName = normalize(input.eventName);
  const candidateName = normalize(candidate.name);
  const organizationName = normalize(candidate.organizationName);
  const exactName = Boolean(eventName && candidateName === eventName);
  const relatedName = Boolean(
    !exactName
    && eventName
    && candidateName
    && (candidateName.includes(eventName) || eventName.includes(candidateName)),
  );
  const organizationMatch = Boolean(
    organizationName
    && eventName
    && (
      organizationName === eventName
      || organizationName.includes(eventName)
      || eventName.includes(organizationName)
    ),
  );
  if (exactName) score += 60;
  else if (relatedName) score += 38;
  if (organizationMatch && !exactName) score += organizationName === eventName ? 22 : 12;

  const candidateCity = normalize(candidate.city);
  const candidateRegion = normalize(candidate.region);
  const inputCity = normalize(input.city);
  const inputRegion = normalize(input.region);
  const cityMatch = Boolean(inputCity && candidateCity === inputCity);
  const regionMatch = Boolean(inputRegion && candidateRegion === inputRegion);
  const cityConflict = Boolean(inputCity && candidateCity && inputCity !== candidateCity);
  const regionConflict = Boolean(inputRegion && candidateRegion && inputRegion !== candidateRegion);
  if (cityMatch) score += 20;
  if (regionMatch) score += 10;

  const overlap = dateOverlapDays(input.actualStartsAt, input.actualEndsAt, candidate.startsAt, candidate.endsAt);
  if (overlap > 0) score += 25;
  else if (input.actualStartsAt && candidate.startsAt) {
    const days = Math.abs(input.actualStartsAt.getTime() - candidate.startsAt.getTime()) / 86_400_000;
    if (days <= 3) score += 12;
    else if (days <= 14) score += 5;
  }

  const managerMatch = Boolean(
    input.managerToken
    && candidate.travelLegName
    && normalize(candidate.travelLegName) === normalize(input.managerToken),
  );
  const managerConflict = Boolean(
    input.managerToken
    && candidate.travelLegName
    && normalize(candidate.travelLegName) !== normalize(input.managerToken),
  );
  if (managerMatch) {
    score += 8;
  }
  const dateConflict = Boolean(
    input.actualStartsAt
    && candidate.startsAt
    && overlap === 0
    && Math.abs(input.actualStartsAt.getTime() - candidate.startsAt.getTime()) / 86_400_000 > 14,
  );
  const dateMatch = overlap > 0 || (
    Boolean(input.actualStartsAt && candidate.startsAt)
    && Math.abs(input.actualStartsAt!.getTime() - candidate.startsAt!.getTime()) / 86_400_000 <= 3
  );
  if (dateMatch && overlap === 0) score += 12;

  // A stale import may be missing dates, a location component, or a leg assignment.
  // Missing evidence is neutral; contradictory evidence is not. An identity match
  // still needs one corroborating signal before it can be selected automatically.
  const identityMatch = exactName || relatedName;
  const corroborated = cityMatch || regionMatch || dateMatch || managerMatch || organizationMatch;
  const reliable = identityMatch
    && corroborated
    && !cityConflict
    && !regionConflict
    && !managerConflict
    && !dateConflict;
  return { score, reliable };
}

export function matchOperationalCalendarEvent(input: {
  eventName: string;
  city: string | null;
  region: string | null;
  actualStartsAt: Date | null;
  actualEndsAt: Date | null;
  managerToken: string | null;
  candidates: OperationalCalendarMatchCandidate[];
}): OperationalMatch {
  const ranked = input.candidates
    .map((candidate) => ({ candidate, ...scoreCandidate(input, candidate) }))
    .filter((item) => item.reliable && item.score >= 45)
    .sort((a, b) => b.score - a.score || a.candidate.name.localeCompare(b.candidate.name));

  if (!ranked.length) return { kind: "new" };
  const best = ranked[0]!;
  const second = ranked[1] ?? null;
  if (second && best.score - second.score < 15) {
    return {
      kind: "review",
      candidateBookingIds: ranked.filter((item) => best.score - item.score < 15).map((item) => item.candidate.bookingId),
      reason: "More than one existing event profile is a plausible calendar match.",
    };
  }
  return {
    kind: "matched",
    bookingId: best.candidate.bookingId,
    organizationId: best.candidate.organizationId,
    confidence: best.score >= 90 ? "high" : "medium",
    score: best.score,
  };
}

export function parseOperationalEventDateText(text: string | null, fallbackYear: number): { startsAt: Date; endsAt: Date } | null {
  if (!text?.trim()) return null;
  const normalized = text
    .trim()
    .replace(/[–—]/g, "-")
    .replace(/\b(\d{1,2})(st|nd|rd|th)\b/gi, "$1")
    .replace(/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+/i, "");
  const explicitYear = /\b(20\d{2})\b/.exec(normalized)?.[1];
  const year = explicitYear ? Number(explicitYear) : fallbackYear;
  const pieces = normalized.split(/\s+-\s+|\s+to\s+/i).map((piece) => piece.trim()).filter(Boolean);

  const parse = (value: string, inheritedMonth?: string) => {
    let source = value;
    if (inheritedMonth && /^\d{1,2}(?:,?\s*20\d{2})?$/.test(source)) source = `${inheritedMonth} ${source}`;
    if (!/\b20\d{2}\b/.test(source)) source = `${source}, ${year}`;
    const date = new Date(`${source} 00:00:00 UTC`);
    return Number.isFinite(date.getTime()) ? date : null;
  };

  const month = /^([A-Za-z]+)\s+/.exec(pieces[0] ?? "")?.[1];
  const startsAt = parse(pieces[0] ?? normalized);
  const endsAt = pieces.length > 1 ? parse(pieces[pieces.length - 1]!, month) : startsAt;
  if (!startsAt || !endsAt || endsAt < startsAt) return null;
  return { startsAt, endsAt };
}
