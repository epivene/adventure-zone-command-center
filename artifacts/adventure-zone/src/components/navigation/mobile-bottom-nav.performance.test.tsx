import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("wouter", () => ({
  Link: ({ children, ...props }: any) => <a {...props}>{children}</a>,
  useLocation: () => ["/today", vi.fn()],
}));

vi.mock("./app-menu", () => ({
  AppMenu: () => <button aria-label="More" type="button">More</button>,
}));

import { MobileBottomNav } from "./mobile-bottom-nav";

describe("MobileBottomNav mobile scroll performance", () => {
  it("uses an opaque fixed surface without backdrop blur", () => {
    render(<MobileBottomNav workspace="booking" />);
    const nav = screen.getByRole("navigation", { name: "Mobile navigation" });
    expect(nav.className).toContain("bg-card");
    expect(nav.className).not.toContain("backdrop-blur");
  });

  it("keeps the five compact Booking destinations reachable with touch-sized controls", () => {
    render(<MobileBottomNav workspace="booking" />);
    const nav = screen.getByRole("navigation", { name: "Mobile navigation" });
    const expected = [
      ["Today", "/today"],
      ["Profiles", "/profiles"],
      ["Emails", "/emails"],
      ["Schedule", "/schedule"],
    ];
    for (const [label, href] of expected) {
      const link = screen.getByRole("link", { name: label });
      expect(link).toHaveAttribute("href", href);
      expect(link.className).toContain("min-h-14");
    }
    expect(screen.getByRole("button", { name: "More" })).toBeInTheDocument();
    expect(nav).not.toHaveTextContent("Website Inquiries");
    expect(nav.className).toContain("env(safe-area-inset-bottom)");
  });
});
