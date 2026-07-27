// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const { routerPush } = vi.hoisted(() => ({ routerPush: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
}));

import { ContactForm } from "@/components/contacts/contact-form";
import { ContactList } from "@/components/contacts/contact-list";
import { SyncStateBadge } from "@/components/contacts/sync-state-badge";
import { AppShell } from "@/components/navigation/app-shell";
import type { ContactListPage } from "@/features/contacts/contact-types";

afterEach(() => {
  cleanup();
  routerPush.mockReset();
});

const contactsPage: ContactListPage = {
  records: [
    {
      id: "contact-1",
      firstName: "Avery",
      lastName: "Example",
      organizationName: "Marias Fair",
      jobTitle: "Director",
      email: "avery@example.com",
      phone: "406-555-0101",
      address1: null,
      address2: null,
      city: "Shelby",
      region: "MT",
      postalCode: "59474",
      syncState: "waiting",
      updatedAt: new Date("2026-07-27T12:00:00Z"),
      lastSyncedAt: null,
    },
  ],
  total: 1,
  page: 1,
  pageSize: 50,
  pageCount: 1,
};

describe("Contacts workspace components", () => {
  it("renders readable synchronization labels", () => {
    const { rerender } = render(<SyncStateBadge state="waiting" />);
    expect(screen.getByText("Waiting to sync")).toBeVisible();

    rerender(<SyncStateBadge state="conflict" />);
    expect(screen.getByText("Needs review")).toBeVisible();

    rerender(<SyncStateBadge state="synced" />);
    expect(screen.getByText("Synced")).toBeVisible();

    rerender(<SyncStateBadge state="unlinked" />);
    expect(screen.getByText("Not linked")).toBeVisible();
  });

  it("shows filters, contact details, and a detail-page link", () => {
    render(
      <ContactList
        contacts={contactsPage}
        query={{ search: "Avery", state: "waiting", page: 1, pageSize: 50 }}
      />,
    );

    expect(screen.getByRole("searchbox", { name: "Search contacts" })).toHaveValue(
      "Avery",
    );
    expect(screen.getByLabelText("Sync status")).toHaveValue("waiting");
    expect(
      screen.getByRole("link", { name: "Avery Example" }),
    ).toHaveAttribute("href", "/contacts/contact-1");
    expect(screen.getByText("Marias Fair")).toBeVisible();
    expect(screen.getByText("avery@example.com")).toBeVisible();
    expect(screen.getByText("Shelby, MT")).toBeVisible();
  });

  it("submits every editable contact field and navigates after success", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue({ ok: true });
    render(
      <ContactForm
        initialValues={{
          firstName: "Avery",
          lastName: "Example",
          organizationName: "Marias Fair",
          email: "avery@example.com",
        }}
        onSubmit={onSubmit}
        successPath="/contacts/contact-1"
        variant="edit"
      />,
    );

    await user.type(screen.getByLabelText("Job title"), "Director");
    await user.type(screen.getByLabelText("City"), "Shelby");
    await user.type(screen.getByLabelText("State"), "MT");
    await user.click(screen.getByRole("button", { name: "Save contact" }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        firstName: "Avery",
        lastName: "Example",
        organizationName: "Marias Fair",
        jobTitle: "Director",
        email: "avery@example.com",
        city: "Shelby",
        region: "MT",
      }),
    );
    expect(routerPush).toHaveBeenCalledWith("/contacts/contact-1");
  });

  it("includes Contacts in desktop and mobile navigation", () => {
    render(
      <AppShell>
        <p>Page content</p>
      </AppShell>,
    );

    const links = screen.getAllByRole("link", { name: "Contacts" });
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link).toHaveAttribute("href", "/contacts");
    }
  });
});
