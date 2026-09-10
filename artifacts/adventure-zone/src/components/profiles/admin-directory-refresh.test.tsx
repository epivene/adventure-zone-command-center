import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ apiGet: vi.fn(), search: "", setLocation: vi.fn() }));

vi.mock("@/lib/auth-token", () => ({ apiGet: mocks.apiGet }));
vi.mock("wouter", () => ({
  Link: ({ href, children, ...props }: any) => <a href={href} {...props}>{children}</a>,
  useLocation: () => ["/profiles", mocks.setLocation],
  useSearch: () => mocks.search,
}));
vi.mock("@/components/organizations/duplicates-view", () => ({ DuplicatesView: () => null }));
vi.mock("@/components/event-families/event-family-suggestions", () => ({ EventFamilySuggestions: () => null }));
vi.mock("@/components/event-families/event-family-card", () => ({ EventFamilyCard: () => null }));
vi.mock("@/components/event-families/manual-event-family-dialog", () => ({ ManualEventFamilyDialog: () => null }));

import { ContactDirectoryView } from "./contact-directory-view";
import OrganizationsPage from "@/pages/OrganizationsPage";

const contactPage = { records: [], total: 0, page: 1, pageCount: 1 };
const profilePage = { organizations: { records: [], total: 0, page: 1, pageCount: 1 }, families: [], travelLegs: [] };

describe("admin directory refresh feedback", () => {
  beforeEach(() => {
    mocks.apiGet.mockReset();
    mocks.setLocation.mockReset();
    mocks.search = "";
  });

  it("keeps contact results visible while a new search loads", async () => {
    mocks.apiGet.mockResolvedValueOnce(contactPage).mockReturnValueOnce(new Promise(() => {}));
    const { rerender } = render(<ContactDirectoryView search="" />);
    expect(await screen.findByText("Showing 0 of 0 contacts")).toBeInTheDocument();

    rerender(<ContactDirectoryView search="?q=mary" />);

    expect(screen.getByText("Showing 0 of 0 contacts")).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Searching contacts" })).toBeInTheDocument();
  });

  it("keeps profile results visible while a new search loads", async () => {
    mocks.apiGet.mockResolvedValueOnce(profilePage).mockReturnValueOnce(new Promise(() => {}));
    const { rerender } = render(<OrganizationsPage />);
    expect(await screen.findByText("Showing 0 of 0 profiles")).toBeInTheDocument();

    mocks.search = "?q=rock";
    rerender(<OrganizationsPage />);
    await waitFor(() => expect(mocks.apiGet).toHaveBeenCalledTimes(2));

    expect(screen.getByText("Showing 0 of 0 profiles")).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Searching profiles" })).toBeInTheDocument();
  });
});
