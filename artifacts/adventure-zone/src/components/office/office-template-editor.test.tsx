import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const editor = readFileSync("src/components/office/office-template-editor.tsx", "utf8");
const protectedText = readFileSync("src/components/office/protected-template-text.tsx", "utf8");

describe("OfficeTemplateEditor protected fields", () => {
  it("renders approved fields through atomic token controls", () => {
    expect(editor).toContain("ProtectedTemplateText");
    expect(editor).toContain("Insert field");
    expect(protectedText).toContain("officeTemplatePlaceholderLabels");
    expect(protectedText).toContain('aria-label={`Remove ${label}`}');
    expect(protectedText).toContain('aria-label={`Move ${label} left`}');
    expect(protectedText).toContain('aria-label={`Move ${label} right`}');
  });

  it("does not expose a text input for editing placeholder names", () => {
    expect(protectedText).not.toContain('name="token"');
    expect(protectedText).not.toContain('placeholder="Token name"');
  });
});
