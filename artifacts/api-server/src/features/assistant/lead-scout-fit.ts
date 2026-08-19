import { isAdultSpecialInterestEvent } from "./lead-scout-priority";
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
  let score = 5;
  const reasons: string[] = [];
  const cautions: string[] = [];
  const adultSpecialInterest = input.hasAdultSpecialInterestSignal
    ?? isAdultSpecialInterestEvent(input.eventName, input.eventType);
  const attendanceScale = input.attendanceScale
    ?? (input.hasAttendanceEvidence ? "medium" : "unknown");

  if (input.hasPublicSource) {
    score += 5;
    reasons.push("public event evidence is available");
  }
  if (input.hasFamilySignal) {
    score += 30;
    reasons.push("child/family-focused audience");
  } else {
    score -= 30;
    cautions.push("No strong child/family-friendly audience signal has been confirmed.");
  }
  if (adultSpecialInterest) {
    score -= 35;
    cautions.push("Adult or special-interest format is a weak fit for a bounce-house carnival.");
  }
  if (input.hasOutdoorSignal) {
    score += 5;
    reasons.push("outdoor/community format can fit traveling attractions");
  }
  if (isMultiDay(input.startsAt, input.endsAt)) {
    score += 18;
    reasons.push("multi-day event");
  }
  if (input.hasVendorPath) {
    score += 10;
    reasons.push("published vendor participation path");
  }
  if (input.hasEntertainmentPath) {
    score += 12;
    reasons.push("published entertainment or attraction booking path");
  }
  if (input.hasOrganizerContact) {
    score += 5;
    reasons.push("organizer contact is available");
  }

  if (attendanceScale === "large") {
    score += 18;
    reasons.push("large public turnout supports a full Adventure Zone setup");
  } else if (attendanceScale === "medium") {
    score += 5;
    reasons.push("moderate attendance may support a smaller Adventure Zone setup");
  } else if (attendanceScale === "small") {
    score -= 25;
    cautions.push("Published attendance appears small for a full bounce-house carnival setup.");
  } else {
    score -= 12;
    cautions.push("Event attendance/scale has not been confirmed yet.");
  }

  if (input.hasLogisticsEvidence) {
    score += 3;
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
