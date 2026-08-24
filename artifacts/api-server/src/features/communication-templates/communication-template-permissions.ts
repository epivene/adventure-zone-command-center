import type { CommunicationTemplateRecord } from "./communication-template-types";

export function canOfficeUseTemplate(
  template: CommunicationTemplateRecord,
  officeAccountId: string,
): boolean {
  if (template.accessScope !== "office" || template.state === "archived") return false;
  if (template.ownerKind === "office_user") {
    return template.ownerOfficeAccountId === officeAccountId;
  }
  return template.state === "active";
}

export function canOfficeMutateTemplate(
  template: CommunicationTemplateRecord,
  officeAccountId: string,
): boolean {
  return (
    template.ownerKind === "office_user"
    && template.ownerOfficeAccountId === officeAccountId
    && template.state !== "archived"
  );
}
