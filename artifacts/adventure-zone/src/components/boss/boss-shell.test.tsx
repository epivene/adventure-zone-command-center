import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

describe("BossShell navigation", () => {
  it("keeps Dave's navigation in one menu without Assignments", async () => {
    const user = userEvent.setup();
    render(<BossShell><p>Page</p></BossShell>);

    await user.click(screen.getByRole("button", { name: "Menu" }));

    expect(screen.getByRole("menuitem", { name: "Documents" })).toHaveAttribute(
      "href",
      "/boss/templates-files",
    );
    expect(screen.getByRole("menuitem", { name: "Invoices & Contracts" })).toHaveAttribute(
      "href",
      "/boss/invoices-contracts",
    );
    expect(screen.getByRole("menuitem", { name: "Home" })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("menuitem", { name: "Assignments" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Assignments" })).not.toBeInTheDocument();
  });

  it("keeps a direct Convention Game shortcut in Dave's menu", async () => {
    const user = userEvent.setup();
    render(<BossShell><p>Page</p></BossShell>);

    await user.click(screen.getByRole("button", { name: "Menu" }));

    expect(screen.getByRole("menuitem", { name: "Convention Game" })).toHaveAttribute(
      "href",
      "/boss/conventions?view=game",
    );
  });
});
