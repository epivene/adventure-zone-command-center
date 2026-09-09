import {
  businessDateKey,
  businessDayBounds,
  parseBusinessDate,
} from "@/lib/business-date";

export const EARLY_BIRD_PROMO = {
  offerCode: "early_bird_promo_2026_2027",
  name: "Early Bird Promo",
  campaignStartDate: "2026-09-09",
  lastEnrollmentDate: "2027-03-31",
  businessTimeZone: "America/Chicago",
  bookingYear: 2027,
  deadlineDays: 30,
  reminderDays: 15,
} as const;

const eligibleCategories = new Set([
  "outreach",
  "rebooking",
  "follow_up",
  "convention",
  "package",
  "objection",
]);

const excludedCodes = new Set([
  "deposit_received",
  "signed_contract_received",
  "coi_information_request",
  "insurance_liability_response",
  "not_this_year_thank_you",
  "thank_you_after_event",
  "holiday_message",
  "ride_inspector_request",
  "internal_coi_request",
]);

const htmlStartMarker = "<!-- early-bird-promo:start -->";
const htmlEndMarker = "<!-- early-bird-promo:end -->";

function addDateKeyDays(value: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error("EARLY_BIRD_PROMO_DATE_INVALID");
  const date = new Date(Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]) + days,
  ));
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function startOfBusinessDate(value: string): Date {
  const parsed = parseBusinessDate(value);
  if (!parsed) throw new Error("EARLY_BIRD_PROMO_DATE_INVALID");
  return businessDayBounds(parsed).start;
}

export function earlyBirdPromoDates(sentAt: Date): {
  deadlineDate: string;
  reminderDate: string;
  expiresAt: Date;
  reminderDueAt: Date;
} {
  const sentDate = businessDateKey(sentAt);
  const deadlineDate = addDateKeyDays(sentDate, EARLY_BIRD_PROMO.deadlineDays);
  const reminderDate = addDateKeyDays(sentDate, EARLY_BIRD_PROMO.reminderDays);
  return {
    deadlineDate,
    reminderDate,
    expiresAt: startOfBusinessDate(addDateKeyDays(deadlineDate, 1)),
    reminderDueAt: startOfBusinessDate(reminderDate),
  };
}

export function formatEarlyBirdPromoDeadline(deadlineDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(deadlineDate);
  if (!match) throw new Error("EARLY_BIRD_PROMO_DATE_INVALID");
  const date = new Date(Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    12,
  ));
  if (
    date.getUTCFullYear() !== Number(match[1])
    || date.getUTCMonth() !== Number(match[2]) - 1
    || date.getUTCDate() !== Number(match[3])
  ) throw new Error("EARLY_BIRD_PROMO_DATE_INVALID");
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function earlyBirdPromoEligibility(input: {
  sentAt: Date;
  category: string | null;
  code: string | null;
  alreadyPaid: boolean;
}): boolean {
  if (input.alreadyPaid || !input.category) return false;
  const sentDate = businessDateKey(input.sentAt);
  return sentDate >= EARLY_BIRD_PROMO.campaignStartDate
    && sentDate <= EARLY_BIRD_PROMO.lastEnrollmentDate
    && eligibleCategories.has(input.category)
    && !excludedCodes.has(input.code ?? "");
}

function promotionSentence(deadlineDate: string): string {
  return `For a limited time, The Adventure Zone is offering 10% off bookings when deposits are received by ${formatEarlyBirdPromoDeadline(deadlineDate)}.`;
}

function plainBlock(deadlineDate: string): string {
  return `Early Bird Promo:\n${promotionSentence(deadlineDate)}`;
}

function htmlBlock(deadlineDate: string): string {
  return `${htmlStartMarker}<div data-early-bird-promo="true"><p><strong>Early Bird Promo:</strong> ${promotionSentence(deadlineDate)}</p></div>${htmlEndMarker}`;
}

function isHtml(body: string): boolean {
  return /<\/?(?:html|body|table|div|p|footer)\b/i.test(body);
}

export function removeEarlyBirdPromoBlock(body: string): string {
  if (isHtml(body)) {
    const pattern = new RegExp(`${htmlStartMarker}[\\s\\S]*?${htmlEndMarker}`, "g");
    return body.replace(pattern, "");
  }
  return body.replace(
    /\n\nEarly Bird Promo:\nFor a limited time, The Adventure Zone is offering 10% off bookings when deposits are received by [^.\n]+\.(?:\n\n)?/g,
    (match) => match.endsWith("\n\n") ? "\n\n" : "",
  );
}

export function upsertEarlyBirdPromoBlock(
  body: string,
  deadlineDate: string,
): string {
  const clean = removeEarlyBirdPromoBlock(body);
  if (isHtml(clean)) {
    const block = htmlBlock(deadlineDate);
    const insertion = clean.search(/<(?:footer\b|div\b[^>]*(?:class|data-[\w-]+)=["'][^"']*(?:footer|signature)[^"']*["'])/i);
    if (insertion >= 0) {
      return `${clean.slice(0, insertion)}${block}${clean.slice(insertion)}`;
    }
    const bodyEnd = clean.search(/<\/body\s*>/i);
    return bodyEnd >= 0
      ? `${clean.slice(0, bodyEnd)}${block}${clean.slice(bodyEnd)}`
      : `${clean}${block}`;
  }

  const block = plainBlock(deadlineDate);
  const signature = clean.search(/\n\n(?=(?:Thanks(?: again)?|Best|Desiree|The Adventure Zone)[,!]?\s*(?:\n|$))/i);
  return signature >= 0
    ? `${clean.slice(0, signature)}\n\n${block}${clean.slice(signature)}`
    : `${clean}\n\n${block}`;
}
