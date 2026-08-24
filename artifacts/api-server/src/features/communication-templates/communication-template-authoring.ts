import {
  allowedTemplatePlaceholders,
  type TemplatePlaceholder,
} from "./communication-template-types";

const tokenPattern = /\{\{([a-zA-Z][a-zA-Z0-9]*)\}\}/g;
const allowed = new Set<string>(allowedTemplatePlaceholders);

export function validateAuthoredTemplateText(input: {
  subjectTemplate: string | null;
  bodyTemplate: string;
}): { placeholders: TemplatePlaceholder[] } {
  const combined = `${input.subjectTemplate ?? ""}\n${input.bodyTemplate}`;
  const placeholders: TemplatePlaceholder[] = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;

  tokenPattern.lastIndex = 0;
  while ((match = tokenPattern.exec(combined)) !== null) {
    const raw = match[1];
    if (!raw || !allowed.has(raw)) throw new Error("INVALID_TEMPLATE_PLACEHOLDER");
    if (!seen.has(raw)) {
      seen.add(raw);
      placeholders.push(raw as TemplatePlaceholder);
    }
  }

  tokenPattern.lastIndex = 0;
  const remainder = combined.replace(tokenPattern, "");
  if (remainder.includes("{{") || remainder.includes("}}")) {
    throw new Error("INVALID_TEMPLATE_PLACEHOLDER");
  }

  return { placeholders };
}
