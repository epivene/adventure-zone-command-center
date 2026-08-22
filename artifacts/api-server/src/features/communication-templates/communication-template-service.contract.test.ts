import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const service = readFileSync(
  path.resolve(process.cwd(), "src/features/communication-templates/communication-template-service.ts"),
  "utf8",
);
const officeRoute = readFileSync(
  path.resolve(process.cwd(), "src/routes/office-communication-templates.ts"),
  "utf8",
);

describe("communication template data boundaries", () => {
  it("accepts recipients through active organization contact membership", () => {
    expect(service).toContain("organizationContacts");
    expect(service).toContain("organizationContacts.active");
    expect(service).not.toContain("eq(contacts.organizationId, input.organizationId)");
  });

  it("loads package choices through reviewed package settings rather than raw unguarded SQL", () => {
    expect(service).toContain("DrizzlePackageIntelligenceSettingsRepository");
    expect(officeRoute).toContain("DrizzlePackageIntelligenceSettingsRepository");
    expect(officeRoute).not.toMatch(/select id, code, name[\s\S]*from package_templates/i);
  });
});
