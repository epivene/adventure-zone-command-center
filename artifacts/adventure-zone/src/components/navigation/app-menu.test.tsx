import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/components/navigation/app-menu.tsx", "utf8");
const mobile = readFileSync("src/components/navigation/mobile-bottom-nav.tsx", "utf8");

describe("owner inquiry navigation menu", () => {
  it("includes website inquiries in Booking tools and the mobile More menu", () => {
    const occurrences = source.match(/href: "\/website-inquiries"/g) ?? [];
    expect(occurrences.length).toBeGreaterThanOrEqual(1);
    expect(source).toContain("const bookingMenuItems = bookingItems");
    expect(source).toContain("websiteInquiryCount > 99");
    expect(source).toContain('"99+"');
    expect(mobile).toContain("websiteInquiryCount={websiteInquiryCount}");
  });

  it("hides the Office Coordinator shortcut from the Booking menu", () => {
    expect(source).not.toContain('{ href: "/office-coordinator", label: "Office Coordinator" }');
  });

  it("keeps the Marketing workspace focused on marketing work", () => {
    const marketingBlock = source.match(/const marketingGroups:[\s\S]*?const adminToolsGroups/)?.[0] ?? "";
    expect(marketingBlock).toContain('href: "/marketing"');
    expect(marketingBlock).toContain('href: "/design-studio"');
    expect(marketingBlock).not.toContain('href: "/profiles"');
    expect(marketingBlock).not.toContain('href: "/office-coordinator"');
    expect(marketingBlock).not.toContain('href: "/research-sources"');
  });
});
