export const groups = [
  "returning",
  "new",
  "replacement",
  "confirm",
  "special",
] as const;
export const outcomes = [
  "not_contacted",
  "sent",
  "replied",
  "interested",
  "follow_up",
  "declined",
  "booked",
  "do_not_contact",
] as const;
export const attendanceKinds = [
  "confirmed",
  "association_only",
  "prior_contact",
  "unknown",
] as const;
export type Member = {
  sourceKey: string;
  event: string;
  contact: string;
  email: string;
  group: (typeof groups)[number];
  outcome: (typeof outcomes)[number];
  attendance: (typeof attendanceKinds)[number];
  notes: string;
  reason: string;
  sources: string;
  nextAction: string;
  research: Record<string, string>;
};
export class ConventionError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}
const text = (v: unknown, max = 12000) => {
  if (v === undefined || v === null) return "";
  if (typeof v !== "string" || v.length > max)
    throw new ConventionError("Invalid or oversized text.");
  return v.trim();
};
function choice<T extends string>(
  v: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  if (v === undefined) return fallback;
  if (!allowed.includes(v as T))
    throw new ConventionError("Invalid classification.");
  return v as T;
}
export function validateMember(value: unknown): Member {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ConventionError("Invalid member.");
  const v = value as Record<string, unknown>;
  const sourceKey = text(v.sourceKey, 300),
    event = text(v.event, 500);
  if (!sourceKey || !event)
    throw new ConventionError("Source key and event are required.");
  const rawResearch = v.research ?? {};
  if (
    typeof rawResearch !== "object" ||
    rawResearch === null ||
    Array.isArray(rawResearch) ||
    Object.keys(rawResearch).length > 64
  )
    throw new ConventionError("Invalid research notes.");
  const research = Object.fromEntries(
    Object.entries(rawResearch).map(([key, value]) => [
      text(key, 200),
      text(value),
    ]),
  );
  if (JSON.stringify(research).length > 60000)
    throw new ConventionError("Research notes are too large.");
  return {
    sourceKey,
    event,
    contact: text(v.contact, 500),
    email: text(v.email, 500),
    group: choice(v.group, groups, "new"),
    outcome: choice(v.outcome, outcomes, "not_contacted"),
    attendance: choice(v.attendance, attendanceKinds, "unknown"),
    notes: text(v.notes),
    reason: text(v.reason),
    sources: text(v.sources),
    nextAction: text(v.nextAction),
    research,
  };
}
export type ProfileCandidate = {
  organizationId: string;
  contactId: string;
  email: string;
  name: string;
};
const normalized = (v: string) => v.trim().toLowerCase().replace(/\s+/g, " ");
export function matchProfile(
  input: { email: string; event: string },
  candidates: ProfileCandidate[],
): ProfileCandidate | null {
  const email = normalized(input.email);
  if (!email) return null;
  const matches = candidates.filter((c) => normalized(c.email) === email);
  if (
    matches.length !== 1 ||
    normalized(matches[0]!.name) !== normalized(input.event)
  )
    return null;
  return matches[0]!;
}
export function nextYearMember(member: Member): Member {
  const contacted = [
    "sent",
    "replied",
    "interested",
    "follow_up",
    "declined",
    "booked",
  ].includes(member.outcome);
  return {
    ...member,
    group: member.group === "new" && contacted ? "returning" : member.group,
    outcome:
      member.outcome === "do_not_contact" ? "do_not_contact" : "not_contacted",
    attendance: "unknown",
    nextAction: "",
  };
}
