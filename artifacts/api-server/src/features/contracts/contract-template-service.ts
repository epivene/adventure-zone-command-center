import type { ContractTemplateDefinition } from "./contract-template-v1";

export function selectActiveTemplate(
  templates: readonly ContractTemplateDefinition[],
  stableKey: string,
): ContractTemplateDefinition {
  const active = templates
    .filter((template) => template.stableKey === stableKey && template.state === "active")
    .toSorted((left, right) => right.version - left.version)[0];
  if (!active) throw new Error("CONTRACT_TEMPLATE_ACTIVE_NOT_FOUND");
  return active;
}

export function activateTemplate(template: ContractTemplateDefinition): ContractTemplateDefinition {
  if (template.state !== "reviewed") throw new Error("CONTRACT_TEMPLATE_REVIEW_REQUIRED");
  return { ...template, state: "active" };
}
