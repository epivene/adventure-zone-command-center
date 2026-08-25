import { createHash } from "node:crypto";

import type {
  ScoutAlertDraft,
  ScoutAlertSeverity,
  ScoutAlertSnapshot,
  ScoutAlertSource,
} from "./scout-alert-types";

const MAX_TITLE = 180;
const MAX_BODY = 1_200;
const MAX_SOURCES = 8;
const MAX_GAPS = 8;
const CRITICAL_GAP = /date|organizer|contact|vendor|application|entertainment|power|electric|space|insurance|water/i;

function bounded(value: string, length: number) {
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed.length <= length ? collapsed : `${collapsed.slice(0, Math.max(0, length - 1)).trimEnd()}…`;
}

function safeSources(sources: ScoutAlertSource[]) {
  const seen = new Set<string>();
  const result: ScoutAlertSource[] = [];
  for (const source of sources) {
    let safe = false;
    try {
      const parsed = new URL(source.url);
      safe = parsed.protocol === "https:" || parsed.protocol === "http:";
    } catch {
      safe = false;
    }
    if (!safe || seen.has(source.url)) continue;
    seen.add(source.url);
    result.push({
      url: source.url.slice(0, 2_000),
      title: bounded(source.title || source.url, 300),
      publisher: source.publisher ? bounded(source.publisher, 200) : null,
      category: bounded(source.category || "other", 80),
      retrievedAt: source.retrievedAt,
    });
    if (result.length >= MAX_SOURCES) break;
  }
  return result;
}

function fingerprint(parts: unknown[]) {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

function normalizeText(value: string | null) {
  return value?.replace(/\s+/g, " ").trim().toLowerCase() || null;
}

function normalizePhone(value: string | null) {
  const digits = value?.replace(/\D/g, "") ?? "";
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits || null;
}

function normalizedContact(snapshot: ScoutAlertSnapshot) {
  return {
    name: normalizeText(snapshot.organizerName),
    email: normalizeText(snapshot.organizerEmail),
    phone: normalizePhone(snapshot.organizerPhone),
  };
}

function displayedContact(snapshot: ScoutAlertSnapshot) {
  return {
    name: snapshot.organizerName,
    email: snapshot.organizerEmail,
    phone: snapshot.organizerPhone,
  };
}

function sameValue(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function utcDay(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const time = Date.UTC(year, month - 1, day);
  const parsed = new Date(time);
  if (
    Number.isNaN(time)
    || parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) return null;
  return time;
}

function deadlineThreshold(deadline: string, now: Date) {
  const deadlineDay = utcDay(deadline);
  if (deadlineDay === null) return null;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const days = Math.floor((deadlineDay - today) / 86_400_000);
  if (days < 0) return null;
  if (days <= 1) return 1;
  if (days <= 7) return 7;
  if (days <= 14) return 14;
  if (days <= 30) return 30;
  return null;
}

function deadlineSeverity(threshold: number): ScoutAlertSeverity {
  if (threshold <= 7) return "urgent";
  if (threshold <= 14) return "attention";
  return "info";
}

function draft(input: Omit<ScoutAlertDraft, "title" | "body" | "sources"> & {
  title: string;
  body: string;
  sources: ScoutAlertSource[];
}): ScoutAlertDraft {
  return {
    ...input,
    title: bounded(input.title, MAX_TITLE),
    body: bounded(input.body, MAX_BODY),
    sources: safeSources(input.sources),
  };
}

function dateValues(snapshot: ScoutAlertSnapshot) {
  return { startsAt: snapshot.startsAt, endsAt: snapshot.endsAt };
}

function hasDates(snapshot: ScoutAlertSnapshot) {
  return Boolean(snapshot.startsAt || snapshot.endsAt);
}

function contactChanged(previous: ScoutAlertSnapshot, current: ScoutAlertSnapshot) {
  return !sameValue(normalizedContact(previous), normalizedContact(current));
}

function meaningfulContact(snapshot: ScoutAlertSnapshot) {
  const contact = normalizedContact(snapshot);
  return Boolean(contact.name || contact.email || contact.phone);
}

function criticalGaps(snapshot: ScoutAlertSnapshot) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const gap of snapshot.coverageGaps) {
    const trimmed = bounded(gap, 500);
    if (!trimmed || !CRITICAL_GAP.test(trimmed)) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
    if (result.length >= MAX_GAPS) break;
  }
  return result;
}

export function evaluateScoutAlerts(input: {
  watchId: string;
  profileName: string;
  previous: ScoutAlertSnapshot | null;
  current: ScoutAlertSnapshot;
  now: Date;
  baseline: boolean;
}): ScoutAlertDraft[] {
  const alerts: ScoutAlertDraft[] = [];
  const profileName = bounded(input.profileName || "Scout profile", 300);
  const sources = input.current.sources;

  if (!input.baseline && input.previous) {
    const beforeDates = dateValues(input.previous);
    const afterDates = dateValues(input.current);
    if (!hasDates(input.previous) && hasDates(input.current)) {
      alerts.push(draft({
        kind: "dates_announced",
        severity: "attention",
        title: "Event dates announced",
        body: `${profileName} now has public event dates that were not available when Scout last checked.`,
        beforeValue: beforeDates,
        afterValue: afterDates,
        sources,
        confidence: "high",
        fingerprint: fingerprint([input.watchId, "dates_announced", afterDates]),
        dueAt: null,
      }));
    } else if (hasDates(input.previous) && !sameValue(beforeDates, afterDates)) {
      alerts.push(draft({
        kind: "dates_changed",
        severity: "attention",
        title: "Event dates changed",
        body: `${profileName} is publishing different event dates than Scout previously recorded.`,
        beforeValue: beforeDates,
        afterValue: afterDates,
        sources,
        confidence: "high",
        fingerprint: fingerprint([input.watchId, "dates_changed", beforeDates, afterDates]),
        dueAt: null,
      }));
    }

    if (!input.previous.applicationAvailable && input.current.applicationAvailable) {
      alerts.push(draft({
        kind: "application_opened",
        severity: "attention",
        title: "Application opportunity found",
        body: `${profileName} now has a public vendor, exhibitor, entertainment, or attraction application path.`,
        beforeValue: {
          available: false,
          url: input.previous.applicationUrl,
        },
        afterValue: {
          available: true,
          url: input.current.applicationUrl,
        },
        sources,
        confidence: "high",
        fingerprint: fingerprint([
          input.watchId,
          "application_opened",
          input.current.applicationUrl,
        ]),
        dueAt: null,
      }));
    }

    if (
      contactChanged(input.previous, input.current)
      && (meaningfulContact(input.previous) || meaningfulContact(input.current))
    ) {
      alerts.push(draft({
        kind: "contact_changed",
        severity: "attention",
        title: "Organizer contact changed",
        body: `${profileName} has different public organizer contact information than Scout previously recorded.`,
        beforeValue: displayedContact(input.previous),
        afterValue: displayedContact(input.current),
        sources,
        confidence: "high",
        fingerprint: fingerprint([
          input.watchId,
          "contact_changed",
          normalizedContact(input.previous),
          normalizedContact(input.current),
        ]),
        dueAt: null,
      }));
    }
  }

  if (input.current.applicationDeadline) {
    const threshold = deadlineThreshold(input.current.applicationDeadline, input.now);
    if (threshold !== null) {
      alerts.push(draft({
        kind: "deadline_approaching",
        severity: deadlineSeverity(threshold),
        title: `Application deadline within ${threshold} day${threshold === 1 ? "" : "s"}`,
        body: `${profileName} has an application deadline of ${input.current.applicationDeadline}.`,
        beforeValue: null,
        afterValue: {
          deadline: input.current.applicationDeadline,
          thresholdDays: threshold,
        },
        sources,
        confidence: "high",
        fingerprint: fingerprint([
          input.watchId,
          "deadline_approaching",
          input.current.applicationDeadline,
          threshold,
        ]),
        dueAt: `${input.current.applicationDeadline}T23:59:59.999Z`,
      }));
    }
  }

  const gaps = criticalGaps(input.current);
  if (gaps.length) {
    alerts.push(draft({
      kind: "needs_verification",
      severity: "info",
      title: "Scout information still needs verification",
      body: `${profileName} still has important booking information that Scout could not confirm.`,
      beforeValue: null,
      afterValue: gaps,
      sources,
      confidence: "medium",
      fingerprint: fingerprint([
        input.watchId,
        "needs_verification",
        [...gaps].map((gap) => gap.toLowerCase()).sort(),
      ]),
      dueAt: null,
    }));
  }

  return alerts;
}

export function monitoringProblemAlert(input: {
  watchId: string;
  profileName: string;
  failureCount: number;
}): ScoutAlertDraft | null {
  if (input.failureCount < 3) return null;
  const profileName = bounded(input.profileName || "Scout profile", 300);
  return draft({
    kind: "monitoring_problem",
    severity: "info",
    title: "Scout could not refresh this profile",
    body: `Scout has been unable to recheck public information for ${profileName}. Existing Command Center information has not been changed.`,
    beforeValue: null,
    afterValue: { consecutiveFailures: input.failureCount },
    sources: [],
    confidence: null,
    fingerprint: fingerprint([input.watchId, "monitoring_problem"]),
    dueAt: null,
  });
}
