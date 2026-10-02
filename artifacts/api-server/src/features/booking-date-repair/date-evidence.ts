export type EvidenceKind = "verified_event" | "verified_reservation" | "sales_milestone" | "unknown_import" | "unresolved_conflict";
export type EndpointEvidence = {
  field: "public_start" | "public_end" | "reservation_start" | "reservation_end";
  kind: EvidenceKind; value: string | null;
  sourceRef: { type: string; id: string; revision: string };
  semantics: "instant" | "inclusive_date" | "exclusive_date";
  revision: number;
};
export type DateEvidenceInput = {
  bookingId: string; rawPublic: { start: string | null; end: string | null };
  rawReservation: { start: string | null; end: string | null };
  evidence: EndpointEvidence[];
};
export type ResolvedDates = {
  rawPublic: DateEvidenceInput["rawPublic"]; rawReservation: DateEvidenceInput["rawReservation"];
  publicWindow: { start: string; end: string } | null;
  reservationWindow: { start: string; end: string } | null;
  publicEndExclusive: boolean; reservationEndExclusive: boolean;
  evidenceState: "verified" | "needs_review"; reviewReasons: string[];
  endpointEvidence: EndpointEvidence[];
};
export type DateRepairProposal = { bookingId: string; reason: string; endpoints: EndpointEvidence[]; clearFields: EndpointEvidence["field"][] };
export type DateRepairPreview = {
  id: string; bookingId: string; actorId: string; expiresAt: string; fingerprint: string;
  before: DateEvidenceInput; after: DateEvidenceInput;
  impacts: { reasons: string[]; affectedBookingIds: string[]; blocked: boolean };
};
export type ApplyDateRepairInput = { previewId: string; fingerprint: string; requestKey: string };
export type DateRepairReceipt = { id: string; bookingId: string; previewId: string; requestKey: string; appliedAt: string };

const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/;
const instantPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
function validDay(value: string): boolean {
  const match = datePattern.exec(value);
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  if (year < 1 || year >= 9999) return false;
  const d = new Date(value + "T00:00:00Z");
  return Number.isFinite(d.getTime()) && d.getUTCFullYear() === year && d.getUTCMonth() + 1 === month && d.getUTCDate() === day;
}
const denverParts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
function denverMidnight(day: string): number {
  const target = Date.parse(day + "T00:00:00Z");
  let guess = target + 7 * 3600000;
  for (let i = 0; i < 3; i++) {
    const p = Object.fromEntries(denverParts.formatToParts(guess).filter(x => x.type !== "literal").map(x => [x.type, x.value]));
    const local = Date.parse(p.year + "-" + p.month + "-" + p.day + "T" + p.hour + ":" + p.minute + ":" + p.second + "Z");
    guess += target - local;
  }
  return guess;
}
/** Convert explicit source semantics; no server-local timezone or date rollover. */
export function dateEndpointInstant(value: string | null, semantics: EndpointEvidence["semantics"], field: EndpointEvidence["field"]): string | null {
  if (!value) return null;
  if (semantics === "instant") {
    if (!instantPattern.test(value) || !validDay(value.slice(0, 10))) return null;
    const n = Date.parse(value);
    if (!Number.isFinite(n) || new Date(n).getUTCFullYear() >= 9999 || new Date(n).getUTCFullYear() < 1) return null;
    return new Date(n).toISOString();
  }
  if (!validDay(value)) return null;
  let n = denverMidnight(value);
  if (field.endsWith("_end") && semantics === "inclusive_date") {
    const next = new Date(Date.parse(value + "T00:00:00Z") + 86400000).toISOString().slice(0, 10);
    if (!validDay(next)) return null;
    n = denverMidnight(next) - 1;
  }
  return new Date(n).toISOString();
}
function resolveEndpoint(input: DateEvidenceInput, field: EndpointEvidence["field"], raw: string | null) {
  const entries = input.evidence.filter(e => e.field === field);
  const revision = Math.max(0, ...entries.map(e => e.revision));
  const latest = entries.filter(e => e.revision === revision);
  const kind = field.startsWith("public_") ? "verified_event" : "verified_reservation";
  const values = latest.map(e => ({ value: dateEndpointInstant(e.value, e.semantics, field), semantics: e.semantics, kind: e.kind }));
  const keys = new Set(values.map(e => JSON.stringify(e)));
  let canonical = raw ? dateEndpointInstant(raw, "instant", field) : null;
  if (canonical && keys.size === 1 && values.length && values[0].semantics !== "instant" && canonical.endsWith("T00:00:00.000Z") && latest[0].value === canonical.slice(0,10))
    canonical = dateEndpointInstant(latest[0].value, values[0].semantics, field);
  if (!canonical || keys.size !== 1 || !values.length || !values[0].value || values[0].kind !== kind || values[0].value !== canonical) return null;
  return { value: canonical, exclusive: values[0].semantics === "exclusive_date" };
}
export function resolveBookingDates(input: DateEvidenceInput): ResolvedDates {
  const reasons: string[] = [];
  const publicStart = resolveEndpoint(input, "public_start", input.rawPublic.start);
  const publicEnd = resolveEndpoint(input, "public_end", input.rawPublic.end);
  const reservedStart = resolveEndpoint(input, "reservation_start", input.rawReservation.start);
  const reservedEnd = resolveEndpoint(input, "reservation_end", input.rawReservation.end);
  function window(start: ReturnType<typeof resolveEndpoint>, end: ReturnType<typeof resolveEndpoint>, label: string, required: boolean) {
    if (!start || !end) { if (required) reasons.push("INCOMPLETE_" + label + "_WINDOW"); return null; }
    if (start.value > end.value || (end.exclusive && start.value === end.value)) { reasons.push("REVERSED_" + label + "_WINDOW"); return null; }
    return { start: start.value, end: end.value };
  }
  const reservationPresent = !!(input.rawReservation.start || input.rawReservation.end || input.evidence.some(e => e.field.startsWith("reservation_")));
  const publicWindow = window(publicStart, publicEnd, "PUBLIC", true);
  const reservationWindow = window(reservedStart, reservedEnd, "RESERVATION", reservationPresent);
  return {
    rawPublic: input.rawPublic, rawReservation: input.rawReservation, publicWindow, reservationWindow,
    publicEndExclusive: publicEnd?.exclusive ?? false, reservationEndExclusive: reservedEnd?.exclusive ?? false,
    evidenceState: reasons.length ? "needs_review" : "verified", reviewReasons: reasons,
    endpointEvidence: input.evidence.filter(e => e.revision === Math.max(...input.evidence.filter(other => other.field === e.field).map(other => other.revision))),
  };
}
