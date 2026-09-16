import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Design Studio email command routes", () => {
  const source = readFileSync(
    path.resolve(process.cwd(), "src/routes/office-design-studio.ts"),
    "utf8",
  );

  it("adds authenticated save and real Gmail draft commands", () => {
    expect(source).toContain(
      '"/office/design-studio/projects/:projectId/email/save"',
    );
    expect(source).toContain(
      '"/office/design-studio/projects/:projectId/email/gmail-draft"',
    );
    expect(source).toContain("requireStudio");
    expect(source).toContain("service.saveInApp(input)");
    expect(source).toContain("service.createGmailDraft(input)");
    expect(source).toContain(
      '"/office/design-studio/projects/:projectId/email/status"',
    );
    for (const command of ["schedule", "reschedule", "cancel", "send"]) {
      expect(source).toContain(
        `\"/office/design-studio/projects/:projectId/email/${command}\"`,
      );
    }
  });

  it("does not accept a client-selected sender", () => {
    expect(source).toContain(
      "const emailContentCommandSchema = z\n  .object({ subject:",
    );
    expect(source).not.toMatch(/emailContentCommandSchema[\s\S]{0,200}from:/i);
  });

  it("keeps delivery state visible if the current contact email is removed", () => {
    expect(source).toContain(
      "designEmailRepository.findCanonicalByProject({ projectId, accountId })",
    );
    expect(source).toContain("let recipientEmail: string | null = null");
    expect(source).toMatch(/res\.json\(\{\s*recipientEmail,\s*draft,/);
  });
});
