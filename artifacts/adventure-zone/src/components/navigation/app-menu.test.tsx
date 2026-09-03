import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/components/navigation/app-menu.tsx", "utf8");
const mobile = readFileSync("src/components/navigation/mobile-bottom-nav.tsx", "utf8");

describe("owner inquiry navigation menu", () => {
  it("includes website inquiries in Booking tools and the mobile More menu", () => {
    const occurrences = source.match(/href: "\/website-inquiries"/g) ?? [];
    expect(occurrences.length).toBeGreaterThanOrEqual(2);
    expect(source).toContain("websiteInquiryCount > 99");
    expect(source).toContain('"99+"');
    expect(mobile).toContain("websiteInquiryCount={websiteInquiryCount}");
  });
});
