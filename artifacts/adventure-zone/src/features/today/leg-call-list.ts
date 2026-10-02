import type { Candidate, Opening, Planner } from "@/features/outreach-planner/outreach-api";
import { classifyBusinessDueDate } from "@/lib/business-date";

export type CallListFollowUp = {
  id: string;
  organizationId: string | null;
  contactId: string | null;
  bookingId: string | null;
  bookingName: string;
  kind: string;
  dueAt: Date | string;
  contactName?: string | null;
  lastContactedAt?: Date | string | null;
  routeLeg?: { id: string; name: string } | null;
  operations?: { leg?: { id: string; name: string } | null } | null;
};
export type LegCallRow = {
  id: string;
  organizationId: string | null;
  contactId: string | null;
  bookingId: string | null;
  followUpId: string | null;
  name: string;
  contactName: string | null;
  season: number | null;
  legId: string | null;
  legName: string;
  reason: string;
  reviewReason: string | null;
  packages: string[];
  openingLabels: string[];
  lastContactAt: string | null;
  dueAt: string | null;
  questions: string[];
  priority: number;
};
const tiers = { dedicated: 0, convention: 1, strong: 2, filler: 3, unclassified: 4 };
const time = (value: Date | string | null | undefined) => value ? new Date(value).getTime() : NaN;
const iso = (value: Date | string | null | undefined) => Number.isFinite(time(value)) ? new Date(value!).toISOString() : null;
export function isCallReminder(kind: string): boolean {
  return /^(call|callback|returned_call)$/i.test(kind.trim()) || /^call\s+(?!list\b|review\b)/i.test(kind.trim());
}
function packageLabels(opening: Opening, planner: Planner) {
  return Object.entries(opening.quantities).filter(([, quantity]) => quantity > 0).map(([id, quantity]) =>
    (planner.packages.find((item) => item.id === id)?.name ?? "Unresolved package") + " × " + quantity);
}
function reviewReason(candidate: Candidate, now: Date): string | null {
  if (candidate.sources.protectedReason) return candidate.sources.protectedReason;
  if (candidate.sources.reviewReasons.length) return candidate.sources.reviewReasons.join("; ");
  if (candidate.sources.pendingSourceReviewIds?.length) return "Contact history needs review.";
  if (candidate.outreach.state === "ready") return "Send the initial email before a prospect call.";
  if (candidate.outreach.state === "reply") return "Review the reply before choosing the next call.";
  if (candidate.outreach.state === "decision") return "Review the decision deadline before choosing the next call.";
  if (candidate.outreach.state === "needs_review") return candidate.outreach.reason;
  if (candidate.portfolio.state !== "first_choice") return candidate.portfolio.reason;
  if (!["follow_up", "advance"].includes(candidate.outreach.state)) return "Review the outreach stage.";
  const priorEmail = candidate.sources.choices.some((source) => source.kind === "sent_email" && source.eligible && time(source.occurredAt) <= now.getTime());
  if (!priorEmail) return "Confirm the initial email and event year before a prospect call.";
  return null;
}
/** Keep event identities separate; one profile may contain several seasons or events. */
export function buildLegCallList(
  followUps: CallListFollowUp[],
  planner: Planner | null,
  now: Date,
  filter: { season: string; legId: string } = { season: "all", legId: "all" },
): LegCallRow[] {
  const allCandidates = planner?.enabled ? planner.candidates : [];
  const matches = (row: LegCallRow) =>
    (filter.season === "all" || row.season === null || String(row.season) === filter.season) &&
    (filter.legId === "all" || row.legId === filter.legId);
  const rows: LegCallRow[] = [];
  for (const followUp of followUps) {
    if (!isCallReminder(followUp.kind) || !Number.isFinite(time(followUp.dueAt)) ||
      classifyBusinessDueDate(new Date(followUp.dueAt), now) === "future") continue;
    const bookingCandidates = followUp.bookingId
      ? allCandidates.filter((candidate) => candidate.bookingId === followUp.bookingId) : [];
    const years = new Set(bookingCandidates.map((candidate) => candidate.eventYear));
    const leg = followUp.routeLeg ?? followUp.operations?.leg;
    const row: LegCallRow = {
      id: "follow-up:" + followUp.id, organizationId: followUp.organizationId,
      contactId: followUp.contactId, bookingId: followUp.bookingId, followUpId: followUp.id,
      name: followUp.bookingName, contactName: followUp.contactName ?? null,
      season: years.size === 1 ? [...years][0] : null, legId: leg?.id ?? null,
      legName: leg?.name ?? "Leg needs review", reason: followUp.kind,
      reviewReason: null, packages: [], openingLabels: [], lastContactAt: iso(followUp.lastContactedAt),
      dueAt: iso(followUp.dueAt), priority: -1,
      questions: ["Confirm you are speaking with the current event organizer.", "Confirm event dates and the next decision or callback date.", "Review the operating plan before promising packages or crew."],
    };
    if (matches(row)) rows.push(row);
  }
  const prospects: LegCallRow[] = [];
  for (const candidate of allCandidates) {
    const opening = planner!.openings.find((item) => item.id === candidate.openingId && item.status === "open");
    if (!opening || candidate.eventYear !== opening.eventYear || candidate.releasedAt ||
      candidate.waitingFor || ["waiting", "inactive"].includes(candidate.portfolio.state) ||
      ["closed", "waiting"].includes(candidate.outreach.state) ||
      time(candidate.snoozedUntil) > now.getTime() || time(candidate.outreach.dueAt) > now.getTime()) continue;
    // A linked scheduled callback owns the next action, even if it is not due yet.
    if (candidate.bookingId && candidate.sources.manualNextActions.some((action) =>
      followUps.some((followUp) => followUp.id === action.id &&
        followUp.bookingId === candidate.bookingId && isCallReminder(followUp.kind)))) continue;
    const contactSources = candidate.sources.choices.filter((source) =>
      source.eligible && source.kind !== "convention" && Number.isFinite(time(source.occurredAt)) && time(source.occurredAt) <= now.getTime());
    const row: LegCallRow = {
      id: "prospect:" + candidate.opportunityId + ":" + candidate.eventYear,
      organizationId: candidate.organizationId, contactId: null, bookingId: candidate.bookingId,
      followUpId: null, name: candidate.organizationName, contactName: null,
      season: candidate.eventYear, legId: opening.legId,
      legName: planner!.legs.find((leg) => leg.id === opening.legId)?.name ?? "Leg needs review",
      reason: candidate.outreach.reason + " " + candidate.portfolio.reason,
      reviewReason: reviewReason(candidate, now) ?? (candidate.sources.manualNextActions.some((action) =>
        isCallReminder(action.kind) && !followUps.some((followUp) => followUp.id === action.id))
        ? "Review the scheduled call on this profile and confirm its event before outreach." : null), packages: packageLabels(opening, planner!),
      openingLabels: [opening.title + " (" + opening.startsOn + " – " + opening.endsOn + ")"],
      lastContactAt: contactSources.map((source) => source.occurredAt).sort((a, b) => time(b) - time(a))[0] ?? null,
      dueAt: iso(candidate.outreach.dueAt),
      priority: tiers[candidate.tier] * 100000 + candidate.manualRank,
      questions: ["Confirm the current organizer and dates for " + candidate.eventYear + ".", "Ask which attractions and package sizes fit the event.", "Confirm interest and the next decision date.", "Check crew, equipment and travel before making an offer."],
    };
    if (candidate.capacity.status !== "fits") {
      row.reason += " Availability needs review: " + candidate.capacityDisplayReasons.join("; ");
    }
    if (matches(row)) prospects.push(row);
  }
  prospects.sort((a, b) => Number(Boolean(a.reviewReason)) - Number(Boolean(b.reviewReason)) || a.priority - b.priority || a.id.localeCompare(b.id));
  const unique = new Map<string, LegCallRow>();
  for (const row of prospects) {
    const existing = unique.get(row.id);
    if (existing) existing.openingLabels.push(...row.openingLabels);
    else unique.set(row.id, row);
  }
  return [...rows, ...unique.values()].sort((a, b) =>
    Number(Boolean(a.reviewReason)) - Number(Boolean(b.reviewReason)) ||
    a.priority - b.priority ||
    (time(a.dueAt) || 0) - (time(b.dueAt) || 0) || a.id.localeCompare(b.id));
}
export function legCallWorkspaceHref(row: LegCallRow): string {
  const parameters = new URLSearchParams();
  if (row.organizationId) parameters.set("organizationId", row.organizationId);
  if (row.contactId) parameters.set("contactId", row.contactId);
  if (row.bookingId) parameters.set("bookingId", row.bookingId);
  if (row.followUpId) parameters.set("followUpId", row.followUpId);
  return "/calls/workspace?" + parameters.toString();
}
