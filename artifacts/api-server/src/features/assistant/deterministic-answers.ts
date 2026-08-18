import type { BookingBrief } from "./booking-brief";
import type {
  AssistantAnswer,
  AssistantSourceReference,
  BookingAssistantBookingSummary,
  BookingAssistantContextBundle,
} from "./assistant-types";

function normalize(question: string): string {
  return question
    .toLowerCase()
    .replace(/[?!.,'’]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sourcesByIds(
  context: BookingAssistantContextBundle,
  sourceIds: readonly string[],
): AssistantSourceReference[] {
  const wanted = new Set(sourceIds);
  return context.sources.filter((source) => wanted.has(source.id));
}

function bookingSource(
  context: BookingAssistantContextBundle,
  bookingId: string,
): AssistantSourceReference[] {
  return context.sources.filter(
    (source) => source.kind === "booking" && source.recordId === bookingId,
  );
}

function followUpSource(
  context: BookingAssistantContextBundle,
  followUpId: string,
): AssistantSourceReference[] {
  return context.sources.filter(
    (source) => source.kind === "follow_up" && source.recordId === followUpId,
  );
}

function deterministic(
  text: string,
  confidence: AssistantAnswer["confidence"],
  sources: AssistantSourceReference[],
): AssistantAnswer {
  return {
    text,
    mode: "deterministic",
    confidence,
    sources,
    needsAdmin: false,
  };
}

function asksLastYear(question: string): boolean {
  return (
    /what .* (last year|previous year)/.test(question) ||
    /what did they book (last year|before)/.test(question) ||
    /what happened (last year|previously)/.test(question)
  );
}

function asksNormalPackage(question: string): boolean {
  return (
    /what do they (normally|usually) book/.test(question) ||
    /usual package/.test(question) ||
    /what package do they usually/.test(question)
  );
}

function asksDifference(question: string): boolean {
  return (
    /different from (last year|before)/.test(question) ||
    /what changed from (last year|before)/.test(question) ||
    /compare .* (last year|previous)/.test(question)
  );
}

function asksFollowUp(question: string): boolean {
  return (
    /what follow ?up/.test(question) ||
    /when.*follow ?up/.test(question) ||
    /what.*due/.test(question)
  );
}

function asksSchedule(question: string): boolean {
  if (/follow ?up|next action|call due/.test(question)) return false;
  return (
    /\bwhat time\b/.test(question) ||
    /\bwhat (date|day)\b/.test(question) ||
    /\bwhen (is|was|does|did|will)\b/.test(question) ||
    /\b(start|starting|end|ending) time\b/.test(question) ||
    /\b(event|booking) schedule\b/.test(question)
  );
}

function asksMainContact(question: string): boolean {
  return (
    /who (is|s) the main contact/.test(question) ||
    /who should i (call|contact)/.test(question) ||
    /primary contact/.test(question)
  );
}

function asksPaintball(question: string): boolean {
  return /paintball/.test(question) && /(last|previous|before|have|had)/.test(question);
}

function asksForgetting(question: string): boolean {
  return (
    /what am i forgetting/.test(question) ||
    /anything (missing|forgotten)/.test(question) ||
    /what.*missing/.test(question)
  );
}

function phraseIncluded(question: string, value: string | null | undefined): boolean {
  const phrase = normalize(value ?? "");
  if (!phrase) return false;
  return ` ${question} `.includes(` ${phrase} `);
}

function bookingScheduleScore(
  booking: BookingAssistantBookingSummary,
  question: string,
): number {
  let score = 0;
  if (phraseIncluded(question, booking.label)) score += 1_000;
  if (phraseIncluded(question, booking.city)) score += 900;
  if (phraseIncluded(question, booking.venueName)) score += 800;
  const location = [booking.city, booking.region].filter(Boolean).join(" ");
  if (phraseIncluded(question, location)) score += 950;
  if (booking.startsAt) {
    const year = String(new Date(booking.startsAt).getUTCFullYear());
    if (phraseIncluded(question, year)) score += 150;
  }
  return score;
}

function selectScheduleBooking(
  context: BookingAssistantContextBundle,
  question: string,
): BookingAssistantBookingSummary | null {
  const bookings = [
    ...(context.currentBooking ? [context.currentBooking] : []),
    ...context.priorBookings.filter(
      (booking) => booking.id !== context.currentBooking?.id,
    ),
  ];
  if (bookings.length === 0) return null;

  const ranked = bookings
    .map((booking, index) => ({
      booking,
      index,
      score: bookingScheduleScore(booking, question),
    }))
    .sort((left, right) =>
      right.score - left.score || left.index - right.index,
    );
  if ((ranked[0]?.score ?? 0) > 0) return ranked[0]?.booking ?? null;

  if (
    context.currentBooking &&
    (/\b(this|current|the) (event|booking)\b/.test(question) ||
      context.context.kind === "booking")
  ) {
    return context.currentBooking;
  }

  return bookings.length === 1 ? bookings[0] ?? null : context.currentBooking;
}

function safeDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function safeTimeZone(value: string | undefined): string {
  if (!value) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date(0));
    return value;
  } catch {
    return "UTC";
  }
}

function bookingDescriptor(booking: BookingAssistantBookingSummary): string {
  const location = [booking.city, booking.region].filter(Boolean).join(", ");
  const venue = booking.venueName?.trim();
  if (venue && location) return `${booking.label} at ${venue} in ${location}`;
  if (location) return `${booking.label} in ${location}`;
  if (venue) return `${booking.label} at ${venue}`;
  return booking.label;
}

function dayKey(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function scheduleText(input: {
  booking: BookingAssistantBookingSummary;
  context: BookingAssistantContextBundle;
  timeZone?: string;
}): string {
  const descriptor = bookingDescriptor(input.booking);
  const startsAt = safeDate(input.booking.startsAt);
  if (!startsAt) {
    return `${descriptor} doesn't have a start time saved in the booking.`;
  }

  const endsAt = safeDate(input.booking.endsAt);
  const timeZone = safeTimeZone(input.timeZone);
  const dateFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const timeFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
  const generatedAt = safeDate(input.context.generatedAt);
  const comparison = endsAt ?? startsAt;
  const tense = generatedAt && comparison.getTime() < generatedAt.getTime()
    ? "was scheduled"
    : "is scheduled";

  if (!endsAt) {
    return `${descriptor} ${tense} for ${dateFormatter.format(startsAt)} at ${timeFormatter.format(startsAt)}.`;
  }

  if (dayKey(startsAt, timeZone) === dayKey(endsAt, timeZone)) {
    return `${descriptor} ${tense} for ${dateFormatter.format(startsAt)}, from ${timeFormatter.format(startsAt)} to ${timeFormatter.format(endsAt)}.`;
  }

  return `${descriptor} ${tense} from ${dateFormatter.format(startsAt)} at ${timeFormatter.format(startsAt)} through ${dateFormatter.format(endsAt)} at ${timeFormatter.format(endsAt)}.`;
}

export function answerDeterministically(input: {
  question: string;
  context: BookingAssistantContextBundle;
  brief: BookingBrief;
  timeZone?: string;
}): AssistantAnswer | null {
  const question = normalize(input.question);
  const context = input.context;

  if (asksLastYear(question)) {
    const prior = context.priorBookings[0];
    if (!prior) {
      return deterministic(
        "I don't have enough saved history to tell what they booked last year.",
        "low",
        [],
      );
    }
    const packageText = prior.packageNames.length
      ? prior.packageNames.join(" + ")
      : "no saved package selection";
    const countText =
      prior.physicalAttractionTotal === null
        ? "no saved main-attraction total"
        : `${prior.physicalAttractionTotal} main attractions`;
    const extras = prior.specialResourceNames.length
      ? ` Special/shared equipment included ${prior.specialResourceNames.join(", ")}.`
      : "";
    return deterministic(
      `${prior.label}: ${packageText}, ${countText}.${extras}`,
      "high",
      bookingSource(context, prior.id),
    );
  }

  if (asksNormalPackage(question)) {
    const item = input.brief.items.find((candidate) => candidate.key === "package_history");
    if (!item) {
      return deterministic(
        "I don't have enough saved booking history to say what they normally book.",
        "low",
        [],
      );
    }
    return deterministic(item.text, item.confidence, sourcesByIds(context, item.sourceIds));
  }

  if (asksDifference(question)) {
    const signal = context.packageHistorySignals.find(
      (candidate) => candidate.kind === "main_attraction_difference",
    );
    const current = context.currentBooking;
    const prior = context.priorBookings[0];
    if (!signal || signal.kind !== "main_attraction_difference" || !current) {
      return deterministic(
        "I don't have enough saved history to compare this booking with last year.",
        "low",
        [],
      );
    }
    const change = Math.abs(signal.difference);
    const countText =
      signal.difference === 0
        ? "the same main-attraction count"
        : `${change} ${signal.difference > 0 ? "more" : "fewer"} main attractions`;
    const currentPackages = new Set(current.packageNames);
    const priorPackages = prior?.packageNames ?? [];
    const missingPackages = priorPackages.filter((name) => !currentPackages.has(name));
    const packageText = missingPackages.length
      ? ` Previous package(s) not currently selected: ${missingPackages.join(", ")}.`
      : "";
    return deterministic(
      `This booking has ${countText} than the most recent comparable booking.${packageText}`,
      "high",
      bookingSource(context, signal.sourceBookingId),
    );
  }

  if (asksFollowUp(question)) {
    const followUp = [...context.openFollowUps].sort((a, b) =>
      a.dueAt.localeCompare(b.dueAt),
    )[0];
    if (!followUp) {
      return deterministic("There isn't an open follow-up saved right now.", "high", []);
    }
    return deterministic(
      `${followUp.label} is the next saved follow-up, due ${new Date(
        followUp.dueAt,
      ).toLocaleString("en-US")}.`,
      "high",
      followUpSource(context, followUp.id),
    );
  }

  if (asksSchedule(question)) {
    const booking = selectScheduleBooking(context, question);
    if (!booking) {
      return deterministic(
        "I don't see a saved booking in this context to check for an event time.",
        "low",
        [],
      );
    }
    return deterministic(
      scheduleText({ booking, context, timeZone: input.timeZone }),
      booking.startsAt ? "high" : "low",
      bookingSource(context, booking.id),
    );
  }

  if (asksMainContact(question)) {
    const contact = context.profile.contacts.find((candidate) => candidate.isPrimary);
    if (!contact) {
      return deterministic("I don't see a primary contact saved for this profile.", "low", []);
    }
    const source = context.sources.filter(
      (candidate) => candidate.recordId === contact.id,
    );
    return deterministic(`${contact.label} is the main saved contact.`, "high", source);
  }

  if (asksPaintball(question)) {
    const prior = context.priorBookings[0];
    if (!prior) {
      return deterministic(
        "I don't have enough saved booking history to tell whether they had paintball before.",
        "low",
        [],
      );
    }
    const paintball = prior.specialResourceNames.find((name) =>
      /paintball/i.test(name),
    );
    return deterministic(
      paintball
        ? `Yes. ${paintball} was included on ${prior.label}.`
        : `I don't see paintball on the most recent saved booking, ${prior.label}.`,
      "high",
      bookingSource(context, prior.id),
    );
  }

  if (asksForgetting(question)) {
    const missing = context.packageHistorySignals.filter(
      (candidate) => candidate.kind === "missing_prior_resource",
    );
    const followUp = [...context.openFollowUps].sort((a, b) =>
      a.dueAt.localeCompare(b.dueAt),
    )[0];
    if (missing.length === 0 && !followUp) {
      return deterministic(
        "I don't see an obvious omission from the saved comparison data or follow-up plan.",
        "medium",
        [],
      );
    }
    const parts: string[] = [];
    const sourceIds: string[] = [];
    for (const signal of missing) {
      if (signal.kind !== "missing_prior_resource") continue;
      parts.push(
        `${signal.resourceName} was on the most recent comparable booking but is not selected now.`,
      );
      sourceIds.push(
        ...bookingSource(context, signal.sourceBookingId).map((source) => source.id),
      );
    }
    if (followUp) {
      parts.push(`You also have this open follow-up: ${followUp.label}.`);
      sourceIds.push(...followUpSource(context, followUp.id).map((source) => source.id));
    }
    return deterministic(
      parts.join(" "),
      "high",
      sourcesByIds(context, sourceIds),
    );
  }

  return null;
}
