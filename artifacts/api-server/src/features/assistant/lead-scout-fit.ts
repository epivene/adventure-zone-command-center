import type { LeadScoutFitInput } from "./lead-scout-types";

function isMultiDay(startsAt: string | null, endsAt: string | null) {
  return Boolean(startsAt && endsAt && startsAt !== endsAt);
}

function deadlinePassed(deadline: string | null, now: Date) {
  if (!deadline || !/^\d{4}-\d{2}-\d{2}$/.test(deadline)) return false;
  const date = new Date(`${deadline}T23:59:59Z`);
  return !Number.isNaN(date.getTime()) && date.getTime() < now.getTime();
}

export function scoreAdventureZoneFit(input: LeadScoutFitInput): {
  score: number;
  reasons: string[];
  cautions: string[];
} {
  let score = 20;
  const reasons: string[] = [];
  const cautions: string[] = [];

  if (input.hasPublicSource) {
    score += 8;
    reasons.push("public event evidence is available");
  }
  if (input.hasFamilySignal) {
    score += 16;
    reasons.push("family-focused audience");
  }
  if (input.hasOutdoorSignal) {
    score += 8;
    reasons.push("outdoor/community format can fit traveling attractions");
  }
  if (isMultiDay(input.startsAt, input.endsAt)) {
    score += 8;
    reasons.push("multi-day event");
  }
  if (input.hasVendorPath) {
    score += 14;
    reasons.push("published vendor participation path");
  }
  if (input.hasEntertainmentPath) {
    score += 16;
    reasons.push("published entertainment or attraction booking path");
  }
  if (input.hasOrganizerContact) {
    score += 8;
    reasons.push("organizer contact is available");
  }
  if (input.hasAttendanceEvidence) {
    score += 5;
    reasons.push("attendance evidence is available");
  }
  if (input.hasLogisticsEvidence) {
    score += 5;
    reasons.push("site/logistics evidence is available");
  }

  if (input.hasExclusiveCarnivalProvider) {
    score -= 55;
    cautions.push("An exclusive or incumbent carnival/amusement provider may block participation.");
  }
  if (deadlinePassed(input.applicationDeadline, input.now)) {
    score -= 40;
    cautions.push("The published application deadline has passed.");
  }
  if (!input.hasVendorPath && !input.hasEntertainmentPath) {
    score -= 25;
    cautions.push("No clear vendor or entertainment participation path has been found yet.");
  }
  if (!input.hasOrganizerContact) {
    score -= 8;
    cautions.push("No direct organizer contact has been confirmed yet.");
  }
  if (input.existenceConfidence === "medium") {
    score -= 8;
    cautions.push("The event's current existence/date evidence is only medium confidence.");
  } else if (input.existenceConfidence === "low") {
    score -= 30;
    cautions.push("The event's current existence is weakly supported and needs confirmation.");
  }

  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    reasons,
    cautions,
  };
}
