import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("wouter", () => ({
  Link: ({ children, ...props }: any) => <a {...props}>{children}</a>,
  useLocation: () => ["/today", vi.fn()],
}));

vi.mock("./app-menu", () => ({
  AppMenu: () => <button type="button">Menu</button>,
}));

import { MobileBottomNav } from "./mobile-bottom-nav";

describe("MobileBottomNav mobile scroll performance", () => {
  it("uses an opaque fixed surface without backdrop blur", () => {
    render(<MobileBottomNav workspace="booking" />);
    const nav = screen.getByRole("navigation", { name: "Mobile navigation" });
    expect(nav.className).toContain("bg-white");
    expect(nav.className).not.toContain("backdrop-blur");
  });

  it("keeps Command Panel in the Booking mobile nav", () => {
    render(<MobileBottomNav workspace="booking" />);
    expect(screen.getByRole("link", { name: /Panel/i })).toHaveAttribute("href", "/command");
  });
});
