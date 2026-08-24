import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/components/office/office-email-editor.tsx", "utf8");

describe("OfficeEmailEditor template authoring", () => {
  it("offers the correct template action modes", () => {
    expect(source).toContain('"Save as Template"');
    expect(source).toContain('"Edit Template"');
    expect(source).toContain('"Save as My Template"');
    expect(source).toContain("selectedTemplate?.editableByOffice");
  });

  it("opens the protected template editor with current email text", () => {
    expect(source).toContain("<OfficeTemplateEditor");
    expect(source).toContain("subjectTemplate: subject");
    expect(source).toContain("bodyTemplate: body");
  });

  it("duplicates company/shared templates before applying private edits", () => {
    expect(source).toContain("/duplicate");
    expect(source).toContain("officePatch");
    expect(source).not.toContain("ownerKind:");
  });

  it("keeps unresolved protected fields blocking Submit Email", () => {
    expect(source).toContain("const unresolvedToken");
    expect(source).toContain("||hasUnresolved");
  });
});
