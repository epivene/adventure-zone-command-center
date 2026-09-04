import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  officeGet: vi.fn(),
  useOfficeAuth: vi.fn(),
}));

vi.mock("@/lib/office-auth-context", () => ({
  officeGet: auth.officeGet,
  useOfficeAuth: auth.useOfficeAuth,
}));
vi.mock("wouter", () => ({
  Link: ({ href, children, ...props }: React.ComponentProps<"a">) => <a href={href} {...props}>{children}</a>,
  useLocation: () => ["/office", vi.fn()],
}));

import { OfficeShell } from "./office-shell";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

beforeEach(() => {
  vi.clearAllMocks();
  auth.officeGet.mockImplementation((path: string) => Promise.resolve(
    path === "/website-inquiries/count" ? { newCount: 104 } : { unreadMessages: 3 },
  ));
});

describe("OfficeShell website inquiry access", () => {
  it("shows the permission-only link, caps its badge, and polls independently", async () => {
    vi.useFakeTimers();
    auth.useOfficeAuth.mockReturnValue({
      office: { accountId: "amy", displayName: "Amy", role: "office_coordinator", canReviewWebsiteInquiries: true },
      signOut: vi.fn(),
    });
    render(<OfficeShell><p>Page</p></OfficeShell>);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getAllByRole("link", { name: /website inquiries/i })).not.toHaveLength(0);
    expect(screen.getAllByText("99+").length).toBeGreaterThan(0);
    expect(auth.officeGet).toHaveBeenCalledWith("/website-inquiries/count");
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(auth.officeGet.mock.calls.filter(([path]) => path === "/website-inquiries/count")).toHaveLength(2);
  });

  it("does not render or request inquiry data without permission", () => {
    auth.useOfficeAuth.mockReturnValue({
      office: { accountId: "staff", displayName: "Staff", role: "office_coordinator", canReviewWebsiteInquiries: false },
      signOut: vi.fn(),
    });
    render(<OfficeShell><p>Page</p></OfficeShell>);
    expect(screen.queryByRole("link", { name: /website inquiries/i })).not.toBeInTheDocument();
    expect(auth.officeGet).not.toHaveBeenCalledWith("/website-inquiries/count");
  });
});
