import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const route = readFileSync(path.resolve(process.cwd(), "src/routes/office-communication-templates.ts"), "utf8");
const editor = readFileSync(path.resolve(process.cwd(), "../adventure-zone/src/components/office/office-email-editor.tsx"), "utf8");

describe("Office communication template boundaries", () => {
  it("exposes private authoring routes without accepting ownership fields from Office", () => {
    expect(route).toContain('router.post("/office/communication-templates"');
    expect(route).toContain('router.patch("/office/communication-templates/:templateId"');
    expect(route).toContain('router.post("/office/communication-templates/:templateId/archive"');
    expect(route).toContain('router.post("/office/communication-templates/:templateId/duplicate"');
    expect(route).not.toContain("ownerKind: parsed.data");
    expect(route).not.toContain("ownerOfficeAccountId: parsed.data");
    expect(route).not.toContain("accessScope: parsed.data");
  });

  it("lists ownership metadata needed by the composer", () => {
    expect(route).toContain("listForOffice(req.officeAccount!.accountId)");
    expect(route).toContain("ownerKind: template.ownerKind");
    expect(route).toContain("editableByOffice:");
    expect(route).toContain("sourceTemplateId: template.sourceTemplateId");
  });

  it("uses the centralized visibility check before rendering", () => {
    expect(route).toContain("canOfficeUseTemplate(template, req.officeAccount!.accountId)");
  });

  it("does not expose commercial rule records or conflicts", () => {
    for (const forbidden of [
      "commercialOffers",
      "sourceConflictNote",
      "Good Deal",
      "Great Deal",
      "Make It Right",
      "convention_12_percent",
      "repeat_customer_500",
    ]) {
      expect(route).not.toContain(forbidden);
      expect(editor).not.toContain(forbidden);
    }
  });

  it("rejects undeclared commercial-offer input because Office request bodies are strict", () => {
    expect(route).toContain(".strict()");
    expect(route).not.toContain("commercialOfferId");
  });
});
