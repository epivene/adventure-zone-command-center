import { describe, expect, it } from "vitest";
import {
  businessSourceDocuments,
  businessSourceFactReviews,
  communicationTemplates,
  officeEmailDrafts,
} from "@workspace/db";

describe("business source schema", () => {
  it("exports source, fact-review, and communication-template tables", () => {
    expect(businessSourceDocuments.originalFilename).toBeDefined();
    expect(businessSourceFactReviews.sourceLocator).toBeDefined();
    expect(communicationTemplates.requiredPlaceholders).toBeDefined();
  });

  it("keeps template provenance on office email drafts", () => {
    expect(officeEmailDrafts.communicationTemplateId).toBeDefined();
  });
});
