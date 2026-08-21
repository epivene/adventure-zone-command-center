import type { AssistantCommand } from "./assistant-command-types";

const websiteTarget = /\b(web ?sites?|urls?|links?)\b/i;
const auditVerb = /\b(check|verify|audit|make sure|validate|test)\b/i;
const ownershipIntent = /\b(match(?:ed|es|ing)?|belong(?:s|ed|ing)?|attached|right profile|correct profile|works?|working|broken|dead)\b/i;
const destructiveVerb = /\b(delete|remove|overwrite|replace|change|update|fix)\b/i;

export function routeAssistantCommand(question: string): AssistantCommand | null {
  const text = question.trim();
  if (!text || destructiveVerb.test(text)) return null;
  if (!websiteTarget.test(text) || !auditVerb.test(text)) return null;
  if (!ownershipIntent.test(text) && !/\ball\b/i.test(text)) return null;

  return {
    kind: "audit",
    capability: "website_verification",
    originalText: text,
    scope: { kind: "all_applicable" },
    parameters: {},
    risk: "read_only",
    confidence: "high",
  };
}
