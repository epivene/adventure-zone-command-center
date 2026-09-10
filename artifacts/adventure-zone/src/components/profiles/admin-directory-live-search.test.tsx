import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { contactListQuerySchema } from "@/features/contacts/contact-input";
import { organizationListQuerySchema } from "@/features/organizations/last-resort-input";

const mocks = vi.hoisted(() => ({ setLocation: vi.fn() }));

vi.mock("wouter", () => ({
  Link: ({ href, children, ...props }: any) => <a href={href} {...props}>{children}</a>,
  useLocation: () => ["/profiles", mocks.setLocation],
}));

import { ContactList } from "@/components/contacts/contact-list";
import { OrganizationList } from "@/components/organizations/organization-list";

const emptyPage = { records: [], total: 0, page: 1, pageCount: 1 };

describe("admin directory live search", () => {
  beforeEach(() => mocks.setLocation.mockReset());

  it("searches profiles while Desiree types and shows progress", async () => {
    render(
      <OrganizationList
        loading={false}
        organizations={emptyPage as any}
        query={organizationListQuerySchema.parse({})}
        travelLegs={[]}
      />,
    );

    const input = screen.getByRole("searchbox", { name: "Search profiles and contacts" });
    expect(input).toHaveStyle({ paddingLeft: "3rem" });
    fireEvent.change(input, { target: { value: "rock springs" } });

    expect(screen.getByRole("status", { name: "Searching profiles" })).toBeInTheDocument();
    await waitFor(() => expect(mocks.setLocation).toHaveBeenCalledWith("/profiles?q=rock+springs"));
    expect(screen.queryByRole("button", { name: "Search" })).not.toBeInTheDocument();
  });

  it("searches contacts while Desiree types and shows progress", async () => {
    render(
      <ContactList
        contacts={emptyPage as any}
        loading={false}
        query={contactListQuerySchema.parse({})}
      />,
    );

    const input = screen.getByRole("searchbox", { name: "Search contacts" });
    expect(input).toHaveStyle({ paddingLeft: "3rem" });
    fireEvent.change(input, { target: { value: "mary" } });

    expect(screen.getByRole("status", { name: "Searching contacts" })).toBeInTheDocument();
    await waitFor(() => expect(mocks.setLocation).toHaveBeenCalledWith("/contacts?q=mary"));
    expect(screen.queryByRole("button", { name: "Search" })).not.toBeInTheDocument();
  });
});
