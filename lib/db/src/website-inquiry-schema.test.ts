import { getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { officeAccounts } from "./office-coordinator-schema";
import {
  websiteInquiries,
  websiteInquiryAlertStateValues,
  websiteInquiryStatusValues,
} from "./website-inquiry-schema";

describe("website inquiry schema", () => {
  it("defines the isolated review queue and supported states", () => {
    expect(getTableName(websiteInquiries)).toBe("website_inquiries");
    expect(websiteInquiryStatusValues).toEqual([
      "new",
      "reviewing",
      "converted",
      "archived",
      "spam",
    ]);
    expect(websiteInquiryAlertStateValues).toEqual([
      "pending",
      "sending",
      "retry",
      "sent",
      "failed",
    ]);
  });

  it("indexes review, matching, duplicate, and alert queries", () => {
    const names = getTableConfig(websiteInquiries).indexes.map(
      (index) => index.config.name,
    );
    expect(names).toEqual(
      expect.arrayContaining([
        "website_inquiries_status_created_idx",
        "website_inquiries_normalized_email_idx",
        "website_inquiries_fingerprint_created_idx",
        "website_inquiries_alert_due_idx",
      ]),
    );
  });

  it("adds an explicit Office permission instead of naming a person", () => {
    expect(officeAccounts.canReviewWebsiteInquiries.name).toBe(
      "can_review_website_inquiries",
    );
  });
});
