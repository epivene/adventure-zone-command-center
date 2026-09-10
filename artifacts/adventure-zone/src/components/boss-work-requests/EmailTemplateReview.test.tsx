import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const review = readFileSync("src/components/boss-work-requests/EmailTemplateReview.tsx", "utf8");
const settings = readFileSync("src/pages/SettingsCommunicationTemplatesPage.tsx", "utf8");
const owner = readFileSync("src/pages/DaveRequestsPage.tsx", "utf8");

describe("seven-email convention review workspace", () => {
  it("gives the owner one action for the whole convention set", () => {
    expect(settings).toContain("Send 7 convention emails to Dave");
    expect(settings).toContain('"/communication-templates/convention-review-set"');
    expect(settings).toContain('priority: "high"');
  });

  it("requires Dave to test safe links before approving each email", () => {
    expect(review).toContain("Test every link");
    expect(review).toContain('target="_blank"');
    expect(review).toContain('rel="noopener noreferrer"');
    expect(review).toContain("review.blockedLinks.length === 0");
    expect(review).toContain("allLinksVerified");
    expect(review).toContain("Approve This Email");
    expect(review).toContain("Desktop preview");
    expect(review).toContain("Mobile preview");
  });

  it("shows every per-email decision and verification to the owner", () => {
    expect(owner).toContain("selected.templateReviews.map");
    expect(owner).toContain("Dave’s note:");
    expect(owner).toContain("Verified links:");
  });
});
