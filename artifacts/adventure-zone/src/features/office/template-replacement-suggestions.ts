import type { OfficeTemplatePlaceholder } from "./template-authoring";

export type TemplateReplacementSuggestion = {
  literal: string;
  token: OfficeTemplatePlaceholder;
  label: string;
};

type Context = {
  contactName?: string | null;
  eventName?: string | null;
  eventCity?: string | null;
  eventState?: string | null;
  eventDates?: string | null;
  packageName?: string | null;
  packagePrice?: string | null;
  packageDuration?: string | null;
};

const candidates: Array<{ key: keyof Context; token: OfficeTemplatePlaceholder; label: string }> = [
  { key: "contactName", token: "contactName", label: "Contact Name" },
  { key: "eventName", token: "eventName", label: "Profile / Event Name" },
  { key: "eventCity", token: "eventCity", label: "Event City" },
  { key: "eventState", token: "eventState", label: "Event State" },
  { key: "eventDates", token: "eventDates", label: "Event Dates" },
  { key: "packageName", token: "packageName", label: "Package Name" },
  { key: "packagePrice", token: "packagePrice", label: "Package Price" },
  { key: "packageDuration", token: "packageDuration", label: "Package Duration" },
];

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsStandaloneLiteral(text: string, literal: string): boolean {
  if (!literal.trim()) return false;
  const pattern = new RegExp(`(^|[^A-Za-z0-9])${escapeRegex(literal)}([^A-Za-z0-9]|$)`, "i");
  return pattern.test(text);
}

export function suggestTemplateReplacements(input: {
  subject: string;
  body: string;
  context: Context;
}): TemplateReplacementSuggestion[] {
  const haystack = `${input.subject}\n${input.body}`;
  const seen = new Set<string>();
  const result: TemplateReplacementSuggestion[] = [];

  for (const candidate of candidates) {
    const literal = input.context[candidate.key]?.trim();
    if (!literal || !containsStandaloneLiteral(haystack, literal)) continue;
    const key = `${candidate.token}:${literal.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ literal, token: candidate.token, label: candidate.label });
  }

  return result;
}

export function replaceTemplateLiteral(
  value: string,
  literal: string,
  token: OfficeTemplatePlaceholder,
): string {
  const pattern = new RegExp(`(^|[^A-Za-z0-9])(${escapeRegex(literal)})(?=[^A-Za-z0-9]|$)`, "gi");
  return value.replace(pattern, (_match, prefix: string) => `${prefix}{{${token}}}`);
}
