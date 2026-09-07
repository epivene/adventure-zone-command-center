import { describe, expect, it } from "vitest";

import type { CommunicationTemplateRecord } from "./communication-template-types";
import { canOfficeMutateTemplate, canOfficeUseTemplate } from "./communication-template-permissions";

const amyId = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";

function template(overrides: Partial<CommunicationTemplateRecord>): CommunicationTemplateRecord {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    code: "test",
    templateVersion: null,
    name: "Test",
    channel: "email",
    category: "outreach",
    accessScope: "office",
    state: "active",
    subjectTemplate: "Hi {{contactName}}",
    bodyTemplate: "Hello {{contactName}}",
    allowedPlaceholders: ["contactName"],
    requiredPlaceholders: ["contactName"],
    ownerKind: "company",
    ownerOfficeAccountId: null,
    createdByKind: "system",
    createdById: null,
    sourceTemplateId: null,
    sourceDocumentId: null,
    sourceNote: null,
    reviewedBy: null,
    reviewedAt: null,
    updatedAt: new Date("2026-08-24T00:00:00Z"),
    ...overrides,
  };
}

describe("communication template Office permissions", () => {
  it("allows active office-safe company templates to be used but not mutated", () => {
    const company = template({ ownerKind: "company" });
    expect(canOfficeUseTemplate(company, amyId)).toBe(true);
    expect(canOfficeMutateTemplate(company, amyId)).toBe(false);
  });

  it("allows active shared Office templates to be used but not mutated", () => {
    const shared = template({ ownerKind: "shared_office" });
    expect(canOfficeUseTemplate(shared, amyId)).toBe(true);
    expect(canOfficeMutateTemplate(shared, amyId)).toBe(false);
  });

  it("lets a coordinator use and mutate their own non-archived private template", () => {
    const own = template({ ownerKind: "office_user", ownerOfficeAccountId: amyId, state: "draft" });
    expect(canOfficeUseTemplate(own, amyId)).toBe(true);
    expect(canOfficeMutateTemplate(own, amyId)).toBe(true);
  });

  it("hides another coordinator's private template", () => {
    const privateTemplate = template({ ownerKind: "office_user", ownerOfficeAccountId: amyId });
    expect(canOfficeUseTemplate(privateTemplate, otherId)).toBe(false);
    expect(canOfficeMutateTemplate(privateTemplate, otherId)).toBe(false);
  });

  it("does not offer archived or owner-only templates to Office users", () => {
    expect(canOfficeUseTemplate(template({ state: "archived" }), amyId)).toBe(false);
    expect(canOfficeUseTemplate(template({ accessScope: "owner" }), amyId)).toBe(false);
  });
});
