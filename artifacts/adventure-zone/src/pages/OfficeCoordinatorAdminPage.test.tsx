// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn(), post: vi.fn(), put: vi.fn() }));
vi.mock("@/lib/auth-token", () => ({ apiGet: api.get, apiPatch: api.patch, apiPost: api.post, apiPut: api.put }));
vi.mock("wouter", () => ({
  Link: ({ href, children, ...props }: React.ComponentProps<"a">) => <a href={href} {...props}>{children}</a>,
  useSearch: () => "",
}));

import OfficeCoordinatorAdminPage from "./OfficeCoordinatorAdminPage";

const source=readFileSync("src/pages/OfficeCoordinatorAdminPage.tsx","utf8");
const menu=readFileSync("src/components/navigation/app-menu.tsx","utf8");

afterEach(cleanup);

describe("owner Office Coordinator controls",()=>{
  it("provides the complete owner workflow",()=>{
    for(const label of ["Work Queue","Email Review","Mail & History","Messages","Account","Add to Queue","Send","Edit & Send","Return for Changes","Reset Password","Disable Account","Sign Out All"]){expect(source).toContain(label);}
  });
  it("lets owner link a task to a profile and a specific contact",()=>{
    expect(source).toContain("Specific contact");
    expect(source).toContain("contactId,");
    expect(source).toContain("/event-profiles/${profile.id}");
    expect(source).toContain("task.contactFirstName");
  });
  it("keeps Office Coordinator in the booking workspace",()=>{
    const bookingItems=menu.slice(menu.indexOf("const bookingItems"),menu.indexOf("const bookingGroups"));
    expect(bookingItems).toContain('{ href: "/office-coordinator", label: "Office Coordinator" }');
    expect(bookingItems).toContain('{ href: "/boss-access", label: "Boss Access" }');
  });
  it("lets Desie create and update Boss login credentials without requiring a documents workspace",()=>{
    expect(source).toContain("Create Boss login");
    expect(source).toContain("Save Login");
    expect(source).toContain("Reset Password");
    expect(source).toContain("studioOfficeAccountId: studioOfficeAccountId || null");
    expect(source).not.toContain("password.length < 8 || !studioOfficeAccountId");
  });
  it("lets the owner grant website inquiry access explicitly", async () => {
    api.get.mockImplementation((path: string) => {
      if (path === "/office-admin/accounts") return Promise.resolve({ accounts: [{ id: "amy", loginName: "amy", displayName: "Amy", role: "office_coordinator", enabled: true, sessionVersion: 1, canReviewWebsiteInquiries: false }] });
      if (path.includes("/tasks")) return Promise.resolve({ tasks: [] });
      if (path.includes("/mail")) return Promise.resolve({ mail: [] });
      if (path.includes("/messages/")) return Promise.resolve({ messages: [] });
      return Promise.resolve({ drafts: [] });
    });
    api.patch.mockResolvedValue({});
    api.post.mockResolvedValue({});
    render(<OfficeCoordinatorAdminPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Account" }));
    const permission = await screen.findByRole("switch", { name: /website inquiries/i });
    expect(permission).not.toBeChecked();
    fireEvent.click(permission);
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith("/office-admin/accounts/amy", { canReviewWebsiteInquiries: true }));
    expect(screen.getByText(/public contact details and convert/i)).toBeInTheDocument();
  });
  it("calls out automatically prepared Early Bird reminders for Boss review",()=>{
    expect(source).toContain("Early Bird 15-day reminder");
    expect(source).toContain("Review before sending");
  });
});
