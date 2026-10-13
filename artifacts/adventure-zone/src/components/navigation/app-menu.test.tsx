import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/components/navigation/app-menu.tsx", "utf8");
const mobile = readFileSync("src/components/navigation/mobile-bottom-nav.tsx", "utf8");

describe("owner inquiry navigation menu", () => {
  it("places Website Inquiries next to Emails in mobile More and avoids a duplicate desktop menu link", () => {
    const bookingItemsStart = source.indexOf("const bookingItems");
    const bookingGroupsStart = source.indexOf("const bookingToolsGroups");
    const bookingItems = source.slice(bookingItemsStart, bookingGroupsStart);
    expect(bookingItems.indexOf('{ href: "/emails", label: "Emails" }')).toBeLessThan(bookingItems.indexOf('{ href: "/website-inquiries", label: "Website Inquiries"'));
    expect(bookingItems.indexOf('{ href: "/website-inquiries", label: "Website Inquiries"')).toBeLessThan(bookingItems.indexOf('{ href: "/emails?view=review", label: "Emails needing review" }'));
    expect(source).toContain('items: bookingItems.filter(item => item.href !== "/website-inquiries")');
    expect(source).toContain("const bookingMenuItems = bookingItems");
    expect(source).toContain('keywords: ["web", "inquiry", "inquiries", "website form", "contact form", "lead"]');
    expect(source).toContain("websiteInquiryCount > 99");
    expect(source).toContain('"99+"');
    expect(mobile).toContain("websiteInquiryCount={websiteInquiryCount}");
    expect(mobile).toContain("searchItems={searchItems}");
    expect(source).toContain('<ToolFinder items={searchItems} variant="menu" />');
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
