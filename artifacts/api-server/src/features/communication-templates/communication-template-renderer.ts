import {
  allowedTemplatePlaceholders,
  type RenderedCommunicationTemplate,
  type TemplatePlaceholder,
  type TemplateRenderValues,
} from "./communication-template-types";

export { allowedTemplatePlaceholders } from "./communication-template-types";

const tokenPattern = /\{\{([a-zA-Z][a-zA-Z0-9]*)\}\}/g;
const allowed = new Set<string>(allowedTemplatePlaceholders);

export function extractTemplateTokens(text: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const match of text.matchAll(tokenPattern)) {
    const token = match[1];
    if (token && !seen.has(token)) {
      seen.add(token);
      result.push(token);
    }
  }
  return result;
}

export function validateTemplatePlaceholders(text: string): void {
  const unknown = extractTemplateTokens(text).filter((token) => !allowed.has(token));
  if (unknown.length > 0) {
    throw new Error(`Unknown template placeholder: ${unknown.join(", ")}`);
  }
}

function renderText(
  text: string,
  values: TemplateRenderValues,
  required: ReadonlySet<TemplatePlaceholder>,
): string {
  validateTemplatePlaceholders(text);
  return text.replace(tokenPattern, (whole, rawToken: string) => {
    if (!allowed.has(rawToken)) return whole;
    const token = rawToken as TemplatePlaceholder;
    const value = values[token]?.trim();
    if (value) return value;
    return required.has(token) ? whole : "";
  });
}

function cleanOptionalWhitespace(text: string): string {
  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function renderCommunicationTemplateText(input: {
  templateId: string;
  subjectTemplate: string | null;
  bodyTemplate: string;
  bodyFormat?: "plain_text" | "html";
  requiredPlaceholders: readonly TemplatePlaceholder[];
  values: TemplateRenderValues;
}): Omit<RenderedCommunicationTemplate, "promotion"> {
  const required = new Set(input.requiredPlaceholders);
  const combined = `${input.subjectTemplate ?? ""}\n${input.bodyTemplate}`;
  validateTemplatePlaceholders(combined);

  const missingRequiredFields = input.requiredPlaceholders.filter(
    (placeholder) => !input.values[placeholder]?.trim(),
  );

  return {
    templateId: input.templateId,
    subject: cleanOptionalWhitespace(
      renderText(input.subjectTemplate ?? "", input.values, required),
    ),
    body: cleanOptionalWhitespace(
      renderText(input.bodyTemplate, input.values, required),
    ),
    bodyFormat: input.bodyFormat ?? "plain_text",
    missingRequiredFields,
  };
}

export function formatPackagePrice(cents: number | null): string | null {
  if (cents === null) return null;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export function formatPackageDuration(
  minimumDays: number | null,
  maximumDays: number | null,
): string | null {
  if (minimumDays === null || maximumDays === null) return null;
  if (minimumDays === maximumDays) {
    return `${minimumDays} ${minimumDays === 1 ? "day" : "days"}`;
  }
  return `${minimumDays}–${maximumDays} days`;
}


