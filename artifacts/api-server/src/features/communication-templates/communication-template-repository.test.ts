import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/features/communication-templates/communication-template-repository.ts", "utf8");

describe("CommunicationTemplateRepository Office ownership operations", () => {
  it("provides ownership-aware Office repository methods", () => {
    for (const method of [
      "listForOffice",
      "createPrivateForOffice",
      "updatePrivateForOffice",
      "archivePrivateForOffice",
      "duplicateForOffice",
      "promoteToShared",
    ]) expect(source).toContain(`${method}(`);
  });

  it("creates private copies with creator provenance", () => {
    expect(source).toContain('ownerKind: "office_user"');
    expect(source).toContain('createdByKind: "office_user"');
    expect(source).toContain("sourceTemplateId: source.id");
  });
});
