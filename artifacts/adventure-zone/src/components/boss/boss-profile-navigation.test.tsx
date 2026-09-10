import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/boss-auth-context", () => ({
  useBossAuth: () => ({ boss: { displayName: "Dave" }, signOut: vi.fn() }),
  bossGet: vi.fn(async () => ({ records: [], families: [], total: 0, page: 1, pageCount: 1 })),
}));
vi.mock("@/lib/appearance", () => ({
  readAppearance: () => "light",
  saveAppearance: vi.fn(),
}));
vi.mock("wouter", () => ({
  Link: ({ href, children, ...props }: any) => <a href={href} {...props}>{children}</a>,
  useLocation: () => ["/boss/profiles", vi.fn()],
  useSearch: () => "",
}));
vi.mock("@workspace/avz-crm/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: any) => <>{children}</>,
  DropdownMenuContent: ({ children }: any) => <>{children}</>,
  DropdownMenuItem: ({ children }: any) => <>{children}</>,
  DropdownMenuLabel: ({ children }: any) => <>{children}</>,
  DropdownMenuSeparator: () => null,
  DropdownMenuTrigger: ({ children }: any) => <>{children}</>,
}));

import { BossShell } from "./boss-shell";
import BossProfilesPage from "@/pages/BossProfilesPage";

describe("Dave profile navigation", () => {
  it("uses one Profiles menu item instead of separate Profiles and Contacts items", () => {
    render(<BossShell><div>Content</div></BossShell>);

    const navigation = screen.getByRole("navigation", { name: "Boss navigation" });
    expect(navigation.querySelector('a[href="/boss/profiles"]')).not.toBeNull();
    expect(navigation.querySelector('a[href="/boss/contacts"]')).toBeNull();
  });

  it("puts Profiles and Contacts choices together inside the profile area", () => {
    render(<BossProfilesPage />);

    expect(screen.getByRole("link", { name: "Profiles" })).toHaveAttribute("href", "/boss/profiles");
    expect(screen.getByRole("link", { name: "Contacts" })).toHaveAttribute("href", "/boss/contacts");
  });
});
