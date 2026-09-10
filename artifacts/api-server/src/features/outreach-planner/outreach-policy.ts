import {
  BUSINESS_TIME_ZONE,
  businessDateKey,
  parseBusinessDate,
} from "../../lib/business-date";

export type OutreachTier =
  "dedicated" | "convention" | "strong" | "filler" | "unclassified";
export type OutreachAttempt = {
  id: string;
  occurredAt: string;
  stage: "initial" | "follow_up_1" | "follow_up_2";
  successful: boolean;
};
export type OutreachPolicyInput = {
  snoozedUntil?: string | null;
  tier: OutreachTier;
  status: string;
  attempts: OutreachAttempt[];
  latestActualAttemptAt?: string | null;
  meaningfulReplyAt: string | null;
  decisionDueAt: string | null;
  conventionEndsOn: string | null;
  operationalStartsOn: string | null;
  blockedReason: string | null;
};
export type OutreachDecision = {
  state:
    | "ready"
    | "waiting"
    | "follow_up"
    | "advance"
    | "reply"
    | "decision"
    | "closed"
    | "needs_review";
  dueAt: string | null;
  reason: string;
  nextStage: OutreachAttempt["stage"] | null;
};
export type OutreachCadence = {
  timelineReviewed?: boolean;
  days: [number, number, number];
  minimumGapDays: number;
  reason: string;
};
export const DEFAULT_OUTREACH_CADENCE: OutreachCadence = {
  days: [3, 10, 15],
  minimumGapDays: 3,
  reason: "Default cadence",
};
export function validCadence(policy: OutreachCadence): boolean {
  return (
    policy.days.length === 3 &&
    (policy.timelineReviewed === undefined || typeof policy.timelineReviewed === "boolean") &&
    Number.isInteger(policy.minimumGapDays) &&
    policy.minimumGapDays > 0 &&
    policy.minimumGapDays <= 3650 &&
    !!policy.reason.trim() &&
    policy.days.every(
      (day, index) =>
        Number.isInteger(day) &&
        day > 0 &&
        day <= 3650 &&
        day - (policy.days[index - 1] ?? 0) >= policy.minimumGapDays,
    )
  );
}
const DAY = 86_400_000;
const ranks: Record<OutreachTier, number> = {
  dedicated: 0,
  convention: 1,
  strong: 2,
  filler: 3,
  unclassified: 4,
};
const stages = ["initial", "follow_up_1", "follow_up_2"] as const;
const closed = new Set([
  "booked",
  "not_pursuing",
  "declined",
  "no_response",
  "territory_hold",
  "cancelled",
  "closed",
  "closed_lost",
  "closed_won",
]);
function instant(value: string): Date | null {
  const match =
    /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(
      value,
    );
  if (
    !match ||
    !parseBusinessDate(match[1]) ||
    +match[2] > 23 ||
    +match[3] > 59 ||
    +match[4] > 59
  )
    return null;
  if (
    match[5] !== "Z" &&
    (+match[5].slice(1, 3) > 23 || +match[5].slice(4) > 59)
  )
    return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}
function result(
  state: OutreachDecision["state"],
  reason: string,
  due: Date | null = null,
  nextStage: OutreachDecision["nextStage"] = null,
): OutreachDecision {
  return { state, reason, dueAt: due?.toISOString() ?? null, nextStage };
}
function conventionDue(value: string): Date {
  const cursor = new Date(`${value}T12:00:00Z`);
  let remaining = 2;
  while (remaining) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (cursor.getUTCDay() !== 0 && cursor.getUTCDay() !== 6) remaining--;
  }
  return parseBusinessDate(cursor.toISOString().slice(0, 10))!;
}
const businessClock = new Intl.DateTimeFormat("en-US", {
  timeZone: BUSINESS_TIME_ZONE,
  hourCycle: "h23",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});
function tierRank(tier: OutreachTier): number {
  return Object.hasOwn(ranks, tier) ? ranks[tier] : ranks.unclassified;
}
/** Roll routine actions forward, retaining local time and the full elapsed interval. */
function routineWeekday(due: Date): Date {
  const key = businessDateKey(due);
  const cursor = new Date(`${key}T12:00:00Z`);
  if (cursor.getUTCDay() !== 0 && cursor.getUTCDay() !== 6) return due;
  while (cursor.getUTCDay() === 0 || cursor.getUTCDay() === 6) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  const targetNoon = parseBusinessDate(cursor.toISOString().slice(0, 10))!;
  const clock = new Map(
    businessClock.formatToParts(due).map((part) => [part.type, part.value]),
  );
  const wallMilliseconds =
    (Number(clock.get("hour")) * 3600 +
      Number(clock.get("minute")) * 60 +
      Number(clock.get("second"))) *
      1000 +
    due.getUTCMilliseconds();
  // The target is Monday, with a stable Chicago offset throughout that day.
  // Extracting clock fields avoids treating Sunday's DST shift as clock time.
  return new Date(
    Math.max(
      due.getTime(),
      targetNoon.getTime() - 12 * 3600000 + wallMilliseconds,
    ),
  );
}
export function evaluateOutreach(
  input: OutreachPolicyInput,
  now: Date,
  policy: OutreachCadence = DEFAULT_OUTREACH_CADENCE,
): OutreachDecision {
  if (closed.has(input.status)) return result("closed", "Pursuit is closed.");
  if (input.blockedReason) return result("needs_review", input.blockedReason);
  if (!Number.isFinite(now.getTime()))
    return result("needs_review", "Current time is invalid.");
  const reply =
    input.meaningfulReplyAt === null ? null : instant(input.meaningfulReplyAt);
  const decision =
    input.decisionDueAt === null ? null : instant(input.decisionDueAt);
  if (
    (input.meaningfulReplyAt !== null && (!reply || reply > now)) ||
    (input.decisionDueAt !== null && !decision)
  )
    return result(
      "needs_review",
      "Reply or decision evidence has an invalid date.",
    );
  const unique = new Map<string, OutreachAttempt>();
  for (const attempt of input.attempts) {
    const at = instant(attempt.occurredAt);
    if (
      !attempt.id ||
      !at ||
      at > now ||
      !stages.includes(attempt.stage) ||
      typeof attempt.successful !== "boolean"
    )
      return result(
        "needs_review",
        "Attempt evidence is invalid or in the future.",
      );
    const previous = unique.get(attempt.id);
    if (
      previous &&
      (previous.occurredAt !== attempt.occurredAt ||
        previous.stage !== attempt.stage ||
        previous.successful !== attempt.successful)
    )
      return result("needs_review", "Duplicate attempt evidence disagrees.");
    unique.set(attempt.id, attempt);
  }
  const completed = [...unique.values()]
    .filter((attempt) => attempt.successful)
    .sort(
      (a, b) =>
        instant(a.occurredAt)!.getTime() - instant(b.occurredAt)!.getTime(),
    );
  for (let index = 0; index < completed.length; index++) {
    if (
      completed[index].stage !== stages[index] ||
      (index > 0 &&
        instant(completed[index].occurredAt)! <=
          instant(completed[index - 1].occurredAt)!)
    )
      return result(
        "needs_review",
        "Successful stages must form a strictly ordered initial and two follow-ups.",
      );
  }
  if (!validCadence(policy))
    return result(
      "needs_review",
      "Cadence requires increasing positive days and an explicit minimum gap and reason.",
    );
  if (
    input.latestActualAttemptAt &&
    (!instant(input.latestActualAttemptAt) ||
      instant(input.latestActualAttemptAt)! > now)
  )
    return result(
      "needs_review",
      "Additional actual outreach has an invalid date.",
    );
  const snooze = input.snoozedUntil ? instant(input.snoozedUntil) : null;
  if (input.snoozedUntil && !snooze)
    return result("needs_review", "Snooze date is invalid.");
  // An explicit decision remains actionable even when the operational timeline is short.
  if (decision)
    return result(
      decision <= now ? "decision" : "waiting",
      "Explicit decision date governs this opportunity.",
      decision,
    );
  if (reply || ["interested", "booking_in_progress"].includes(input.status))
    return result(
      "reply",
      "Meaningful interest requires a response, not silence-based advancement.",
      reply,
    );
  if (
    (input.conventionEndsOn !== null &&
      !parseBusinessDate(input.conventionEndsOn)) ||
    (input.operationalStartsOn !== null &&
      !parseBusinessDate(input.operationalStartsOn))
  )
    return result("needs_review", "Operational or convention date is invalid.");
  if (input.operationalStartsOn) {
    const start = Date.parse(`${input.operationalStartsOn}T00:00:00Z`);
    const today = Date.parse(`${businessDateKey(now)}T00:00:00Z`);
    if (start - today <= 45 * DAY && policy.timelineReviewed !== true)
      return result(
        "needs_review",
        "Operational start is within 45 days; record an explicit timeline review with the owner-selected cadence.",
      );
  }
  if (input.tier === "dedicated")
    return result(
      "needs_review",
      "Set a dedicated renewal review or decision date before pursuing this returning event.",
    );
  if (!completed.length) {
    if (!Object.hasOwn(ranks, input.tier) || input.tier === "unclassified")
      return result(
        "needs_review",
        "Classify this opportunity before new pursuit.",
      );
    if (input.tier === "convention" && !input.conventionEndsOn)
      return result("needs_review", "Convention end date is missing.");
    if (snooze && snooze > now)
      return result(
        "waiting",
        "Owner snoozed routine outreach; existing callbacks and replies retain priority.",
        snooze,
      );
    return result(
      "ready",
      "No successful initial outreach is recorded.",
      input.tier === "convention"
        ? conventionDue(input.conventionEndsOn!)
        : null,
      "initial",
    );
  }
  if (snooze && snooze > now)
    return result(
      "waiting",
      "Owner snoozed routine outreach; existing callbacks and replies retain priority.",
      snooze,
    );
  const first = instant(completed[0].occurredAt)!;
  let last = instant(completed[completed.length - 1].occurredAt)!;
  if (input.latestActualAttemptAt) {
    const actual = instant(input.latestActualAttemptAt);
    if (!actual || actual > now)
      return result(
        "needs_review",
        "Additional actual outreach has an invalid date.",
      );
    if (actual > last) last = actual;
  }
  const due = routineWeekday(
    new Date(
      Math.max(
        first.getTime() + policy.days[completed.length - 1] * DAY,
        last.getTime() +
          Math.max(
            policy.minimumGapDays,
            policy.days[completed.length - 1] -
              (policy.days[completed.length - 2] ?? 0),
          ) *
            DAY,
      ),
    ),
  );
  const next = stages[completed.length] ?? null;
  return result(
    due > now ? "waiting" : next ? "follow_up" : "advance",
    next
      ? "Next successful outreach stage is due after its full cadence interval."
      : "All outreach stages completed; advancement requires review by the planner.",
    due,
    next,
  );
}
export function compareOutreachPriority(
  left: { tier: OutreachTier; manualRank: number; id: string },
  right: { tier: OutreachTier; manualRank: number; id: string },
): number {
  return (
    tierRank(left.tier) - tierRank(right.tier) ||
    left.manualRank - right.manualRank ||
    (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
  );
}
