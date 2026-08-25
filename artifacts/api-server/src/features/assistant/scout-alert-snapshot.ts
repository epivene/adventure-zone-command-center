import {
  isOperationallyReliableFact,
  selectBestFact,
} from "./lead-scout-evidence";
import type {
  LeadScoutCandidateView,
  LeadScoutEvidenceFact,
  LeadScoutSourceInput,
} from "./lead-scout-types";
import type {
  ScoutAlertSnapshot,
  ScoutAlertSource,
} from "./scout-alert-types";

const MAX_SOURCES = 12;
const MAX_GAPS = 20;
const ISO_DATE = /\b(\d{4}-\d{2}-\d{2})\b/g;
const URL_PATTERN = /https?:\/\/[^\s<>"')\]]+/gi;
const MONTHS: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

function text(value: string | null | undefined) {
  const normalized = value?.replace(/\s+/g, " ").trim() ?? "";
  return normalized || null;
}

function email(value: string | null | undefined) {
  return text(value)?.toLowerCase() ?? null;
}

function phone(value: string | null | undefined) {
  const digits = value?.replace(/\D/g, "") ?? "";
  const normalized = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (!normalized) return null;
  if (normalized.length === 10) return `${normalized.slice(0, 3)}-${normalized.slice(3, 6)}-${normalized.slice(6)}`;
  return normalized;
}

function safeUrl(value: string | null | undefined) {
  const candidate = value?.trim() ?? "";
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? candidate : null;
  } catch {
    return null;
  }
}

function safeSources(sources: LeadScoutSourceInput[]): ScoutAlertSource[] {
  const seen = new Set<string>();
  const result: ScoutAlertSource[] = [];
  for (const source of sources) {
    const url = safeUrl(source.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    result.push({
      url,
      title: text(source.title) ?? url,
      publisher: text(source.publisher),
      category: source.category,
      retrievedAt: source.retrievedAt,
    });
    if (result.length >= MAX_SOURCES) break;
  }
  return result;
}

function gaps(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = text(value);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized.slice(0, 500));
    if (result.length >= MAX_GAPS) break;
  }
  return result;
}

function validIsoDate(value: string | null | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : value;
}

function isoDates(value: string) {
  return [...value.matchAll(ISO_DATE)]
    .map((match) => validIsoDate(match[1]))
    .filter((date): date is string => Boolean(date));
}

function paddedDate(year: number, month: number, day: number) {
  const value = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return validIsoDate(value);
}

function naturalDateRange(value: string) {
  const range = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:\s*[-–—]\s*(\d{1,2}))?,?\s+(\d{4})\b/i.exec(value);
  if (!range) return [];
  const month = MONTHS[range[1]!.toLowerCase()];
  if (!month) return [];
  const start = paddedDate(Number(range[4]), month, Number(range[2]));
  const end = range[3] ? paddedDate(Number(range[4]), month, Number(range[3])) : start;
  return [start, end].filter((date): date is string => Boolean(date));
}

function dateRange(value: string) {
  const iso = isoDates(value);
  return iso.length ? [iso[0]!, iso[1] ?? iso[0]!] : naturalDateRange(value);
}

function reliableFact(
  facts: LeadScoutEvidenceFact[],
  sources: LeadScoutSourceInput[],
  predicate: (fact: LeadScoutEvidenceFact) => boolean,
) {
  const selected = selectBestFact(facts.filter(predicate), sources);
  return isOperationallyReliableFact(selected, sources) ? selected : null;
}

function explicitApplicationUrl(value: string | null | undefined) {
  const summary = value ?? "";
  if (!/application|apply|vendor|exhibitor|entertainment|attraction/i.test(summary)) return null;
  return [...summary.matchAll(URL_PATTERN)].map((match) => safeUrl(match[0])).find(Boolean) ?? null;
}

function sourceApplicationUrl(sources: LeadScoutSourceInput[]) {
  return sources
    .filter((source) => source.category === "vendor_application")
    .map((source) => safeUrl(source.url))
    .find(Boolean) ?? null;
}

function baselineApplicationUrl(candidate: LeadScoutCandidateView, sources: LeadScoutSourceInput[]) {
  return explicitApplicationUrl(candidate.vendorSummary)
    ?? sourceApplicationUrl(sources)
    ?? null;
}

function factApplicationUrl(fact: LeadScoutEvidenceFact | null) {
  if (!fact) return null;
  return [...fact.value.matchAll(URL_PATTERN)].map((match) => safeUrl(match[0])).find(Boolean)
    ?? safeUrl(fact.value);
}

function baseSnapshot(input: {
  candidate: LeadScoutCandidateView;
  sources: LeadScoutSourceInput[];
  coverageGaps: string[];
  now: Date;
}): ScoutAlertSnapshot {
  const applicationUrl = baselineApplicationUrl(input.candidate, input.sources);
  return {
    startsAt: validIsoDate(input.candidate.startsAt),
    endsAt: validIsoDate(input.candidate.endsAt),
    applicationAvailable: Boolean(applicationUrl),
    applicationUrl,
    applicationDeadline: validIsoDate(input.candidate.applicationDeadline),
    organizerName: text(input.candidate.organizerName),
    organizerEmail: email(input.candidate.organizerEmail),
    organizerPhone: phone(input.candidate.organizerPhone),
    coverageGaps: gaps(input.coverageGaps),
    sources: safeSources(input.sources),
    capturedAt: input.now.toISOString(),
  };
}

export function baselineScoutAlertSnapshot(input: {
  candidate: LeadScoutCandidateView;
  sources: LeadScoutSourceInput[];
  now: Date;
}): ScoutAlertSnapshot {
  return baseSnapshot({
    candidate: input.candidate,
    sources: input.sources,
    coverageGaps: input.candidate.coverageGaps,
    now: input.now,
  });
}

export function researchedScoutAlertSnapshot(input: {
  candidate: LeadScoutCandidateView;
  facts: LeadScoutEvidenceFact[];
  sources: LeadScoutSourceInput[];
  coverageGaps: string[];
  now: Date;
}): ScoutAlertSnapshot {
  const baseline = baseSnapshot(input);

  const schedule = reliableFact(input.facts, input.sources, (fact) =>
    fact.category === "schedule" && /date|start|end|through|schedule/i.test(`${fact.key} ${fact.value}`),
  );
  const scheduleDates = schedule ? dateRange(schedule.value) : [];

  const deadline = reliableFact(input.facts, input.sources, (fact) =>
    fact.category === "vendor" && /deadline|due_date|apply_by|apply by/i.test(`${fact.key} ${fact.value}`),
  );
  const deadlineDate = deadline ? dateRange(deadline.value)[0] ?? isoDates(deadline.value)[0] : null;

  const application = reliableFact(input.facts, input.sources, (fact) =>
    fact.category === "vendor" && /application|apply|vendor|exhibitor|entertainment|attraction/i.test(`${fact.key} ${fact.value}`),
  );
  const applicationUrl = factApplicationUrl(application)
    ?? baseline.applicationUrl
    ?? sourceApplicationUrl(input.sources);

  const organizerName = reliableFact(input.facts, input.sources, (fact) =>
    fact.category === "contact" && /organizer.*name|contact.*name|organizer_name|contact_name/i.test(fact.key),
  );
  const organizerEmail = reliableFact(input.facts, input.sources, (fact) =>
    fact.category === "contact" && /email/i.test(fact.key),
  );
  const organizerPhone = reliableFact(input.facts, input.sources, (fact) =>
    fact.category === "contact" && /phone|telephone/i.test(fact.key),
  );

  return {
    ...baseline,
    startsAt: scheduleDates[0] ?? baseline.startsAt,
    endsAt: scheduleDates[1] ?? scheduleDates[0] ?? baseline.endsAt,
    applicationAvailable: Boolean(applicationUrl),
    applicationUrl: applicationUrl ?? null,
    applicationDeadline: deadlineDate ?? baseline.applicationDeadline,
    organizerName: text(organizerName?.value) ?? baseline.organizerName,
    organizerEmail: email(organizerEmail?.value) ?? baseline.organizerEmail,
    organizerPhone: phone(organizerPhone?.value) ?? baseline.organizerPhone,
    coverageGaps: gaps(input.coverageGaps),
    sources: safeSources(input.sources),
    capturedAt: input.now.toISOString(),
  };
}
