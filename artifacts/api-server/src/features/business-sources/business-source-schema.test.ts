import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  businessSourceDocuments,
  businessSourceFactReviews,
  communicationTemplates,
  officeEmailDrafts,
} from "@workspace/db";

const migration = readFileSync(
  path.resolve(process.cwd(), "../../lib/db/migrations/20260822_business_source_copy.sql"),
  "utf8",
).toLowerCase();

describe("business source schema", () => {
  it("exports source, fact-review, and communication-template tables", () => {
    expect(businessSourceDocuments.originalFilename).toBeDefined();
    expect(businessSourceFactReviews.sourceLocator).toBeDefined();
    expect(communicationTemplates.requiredPlaceholders).toBeDefined();
  });

  it("keeps template provenance on office email drafts", () => {
    expect(officeEmailDrafts.communicationTemplateId).toBeDefined();
  });

  it("adds the template foreign key even when the Office startup guard created the nullable column first", () => {
    expect(migration).toContain("office_email_drafts_communication_template_fk");
    expect(migration).toContain("foreign key (communication_template_id)");
    expect(migration).toContain("references communication_templates(id)");
  });
});
