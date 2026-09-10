import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/boss-auth-context", () => ({
  useBossAuth: () => ({ boss: { displayName: "Dave" }, signOut: vi.fn() }),
}));
vi.mock("wouter", () => ({
  useLocation: () => ["/boss"],
  Link: ({ href, children, ...props }: any) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

import { BossShell } from "./boss-shell";

afterEach(cleanup);

describe("BossShell convention access", () => {
  it("puts a direct Convention Game shortcut in Dave's navigation", () => {
    render(<BossShell><p>Page</p></BossShell>);

    const shortcuts = screen.getAllByRole("link", { name: "Convention Game" });
    expect(shortcuts).toHaveLength(2);
    for (const shortcut of shortcuts) {
      expect(shortcut).toHaveAttribute("href", "/boss/conventions?view=game");
    }
  });
});
