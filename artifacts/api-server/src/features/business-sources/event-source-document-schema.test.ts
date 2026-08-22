import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";

import {
  businessSourceDocumentFiles,
  businessSourceDocumentLinks,
  businessSourceHistoricalTerms,
  historicalTermValueTypeValues,
  sourceDocumentLinkKindValues,
} from "@workspace/db/business-source-schema";

describe("event source document schema", () => {
  it("stores protected file metadata, one-target links, and historical terms", () => {
    expect(businessSourceDocumentFiles.sha256Hex).toBeDefined();
    expect(businessSourceDocumentFiles.storageKey).toBeDefined();
    expect(businessSourceDocumentLinks.organizationId).toBeDefined();
    expect(businessSourceDocumentLinks.organizationLocationId).toBeDefined();
    expect(businessSourceDocumentLinks.bookingId).toBeDefined();
    expect(businessSourceDocumentLinks.packageTemplateId).toBeDefined();
    expect(businessSourceHistoricalTerms.sourceLocator).toBeDefined();
    expect(businessSourceHistoricalTerms.reviewState).toBeDefined();
  });

  it("keeps link kinds and historical value types constrained", () => {
    expect(sourceDocumentLinkKindValues).toEqual([
      "profile",
      "location",
      "booking",
      "package_reference",
    ]);
    expect(historicalTermValueTypeValues).toEqual([
      "text",
      "money_cents",
      "date",
      "date_range",
      "integer",
      "boolean",
    ]);
  });

  it("uses partial uniqueness for each nullable link target", () => {
    const indexes = getTableConfig(businessSourceDocumentLinks).indexes;
    for (const name of [
      "business_source_document_links_profile_unique",
      "business_source_document_links_location_unique",
      "business_source_document_links_booking_unique",
      "business_source_document_links_package_unique",
    ]) {
      const index = indexes.find((item) => item.config.name === name);
      expect(index?.config.unique).toBe(true);
      expect(index?.config.where).toBeDefined();
    }
  });
});
