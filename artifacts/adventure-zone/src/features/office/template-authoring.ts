export const officeTemplatePlaceholders = [
  "contactName",
  "eventName",
  "eventCity",
  "eventState",
  "eventDates",
  "senderName",
  "senderPhone",
  "senderEmail",
  "packageName",
  "packagePrice",
  "packageDuration",
  "followUpDate",
  "conventionName",
  "additionalInsuredWording",
  "additionalInsuredInfo",
] as const;

export type OfficeTemplatePlaceholder = (typeof officeTemplatePlaceholders)[number];

export type TemplateSegment =
  | { kind: "text"; value: string }
  | { kind: "token"; token: OfficeTemplatePlaceholder };

const tokenPattern = /\{\{([a-zA-Z][a-zA-Z0-9]*)\}\}/g;
const allowed = new Set<string>(officeTemplatePlaceholders);

export const officeTemplatePlaceholderLabels: Record<OfficeTemplatePlaceholder, string> = {
  contactName: "Contact Name",
  eventName: "Profile / Event Name",
  eventCity: "Event City",
  eventState: "Event State",
  eventDates: "Event Dates",
  senderName: "Sender Name",
  senderPhone: "Sender Phone",
  senderEmail: "Sender Email",
  packageName: "Package Name",
  packagePrice: "Package Price",
  packageDuration: "Package Duration",
  followUpDate: "Follow-up Date",
  conventionName: "Convention Name",
  additionalInsuredWording: "Additional Insured Wording",
  additionalInsuredInfo: "Additional Insured Info",
};

export function parseTemplateSegments(value: string): TemplateSegment[] {
  const segments: TemplateSegment[] = [];
  let cursor = 0;
  tokenPattern.lastIndex = 0;
  for (const match of value.matchAll(tokenPattern)) {
    const raw = match[1];
    if (!raw || !allowed.has(raw)) throw new Error("INVALID_TEMPLATE_PLACEHOLDER");
    if (match.index > cursor) segments.push({ kind: "text", value: value.slice(cursor, match.index) });
    segments.push({ kind: "token", token: raw as OfficeTemplatePlaceholder });
    cursor = match.index + match[0].length;
  }
  if (cursor < value.length) segments.push({ kind: "text", value: value.slice(cursor) });
  if (!segments.length) segments.push({ kind: "text", value });

  const serialized = serializeTemplateSegments(segments);
  const remainder = value.replace(tokenPattern, "");
  if (remainder.includes("{{") || remainder.includes("}}") || serialized !== value) {
    throw new Error("INVALID_TEMPLATE_PLACEHOLDER");
  }
  return segments;
}

export function serializeTemplateSegments(segments: readonly TemplateSegment[]): string {
  return segments.map((segment) =>
    segment.kind === "text" ? segment.value : `{{${segment.token}}}`,
  ).join("");
}

export function appendTemplateToken(value: string, token: OfficeTemplatePlaceholder): string {
  if (!allowed.has(token)) throw new Error("INVALID_TEMPLATE_PLACEHOLDER");
  return `${value}{{${token}}}`;
}
