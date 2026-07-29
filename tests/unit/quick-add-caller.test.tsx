// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const { routerPush } = vi.hoisted(() => ({ routerPush: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
}));

import { QuickAddCaller } from "@/components/contacts/quick-add-caller";
import { AppShell } from "@/components/navigation/app-shell";
import type { ContactListRecord } from "@/features/contacts/contact-types";

afterEach(() => {
  cleanup();
  routerPush.mockReset();
});

const caller: ContactListRecord = {
  id: "caller-1",
  firstName: "Avery",
  lastName: "Example",
  organizationName: "Marias Fair",
  jobTitle: null,
  email: "avery@example.com",
  phone: "406-555-0101",
  address1: null,
  address2: null,
  city: "Shelby",
  region: "MT",
  postalCode: null,
  syncState: "synced",
  updatedAt: new Date("2026-07-28T12:00:00Z"),
  lastSyncedAt: new Date("2026-07-28T12:00:00Z"),
};

describe("QuickAddCaller", () => {
  it("collects only the minimum new-caller details and preserves an unmatched phone", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue({ ok: true, contactId: "new-contact" });
    render(
      <QuickAddCaller
        match={{ kind: "none", normalizedPhone: "+14065550101" }}
        initialPhone="(406) 555-0101"
        onSubmit={onSubmit}
      />,
    );

    expect(screen.getByLabelText("Name")).toBeRequired();
    expect(screen.getByLabelText("Organization or event")).toBeRequired();
    expect(screen.getByLabelText("Phone")).toHaveValue("(406) 555-0101");
    expect(screen.getByLabelText("Email")).not.toBeRequired();
    expect(screen.getByLabelText("Reason for calling")).toBeRequired();
    expect(screen.getByLabelText("Event date (optional)")).toBeInTheDocument();
    expect(screen.getByLabelText("Event location (optional)")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Name"), "Avery Example");
    await user.type(screen.getByLabelText("Organization or event"), "Marias Fair");
    await user.type(screen.getByLabelText("Reason for calling"), "Asked about an August event.");
    await user.click(screen.getByRole("button", { name: "Create caller" }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      requestKey: expect.stringMatching(/^[0-9a-f-]{36}$/),
      name: "Avery Example",
      organizationName: "Marias Fair",
      phone: "(406) 555-0101",
      reason: "Asked about an August event.",
    }));
    expect(routerPush).toHaveBeenCalledWith("/calls/new?contactId=new-contact");
  });

  it("requires a phone or email for a new caller", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<QuickAddCaller match={{ kind: "none", normalizedPhone: "" }} onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText("Name"), "Avery Example");
    await user.type(screen.getByLabelText("Organization or event"), "Marias Fair");
    await user.type(screen.getByLabelText("Reason for calling"), "Asked about an August event.");
    await user.click(screen.getByRole("button", { name: "Create caller" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Enter a phone number or email address.");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("shows a keyboard-accessible chooser for multiple exact phone matches", () => {
    render(<QuickAddCaller match={{ kind: "many", contacts: [caller, { ...caller, id: "caller-2", firstName: "Bailey" }] }} />);

    expect(screen.getByRole("heading", { name: "Choose the caller" })).toBeVisible();
    const choices = screen.getAllByRole("link", { name: /Open .* in Call Workspace/ });
    expect(choices).toHaveLength(2);
    expect(choices[0]).toHaveAttribute("href", "/calls/new?contactId=caller-1");
  });

  it("stops a typed duplicate submission at the fresh server match and preserves the caller details", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue({
      ok: false,
      match: { kind: "many", contacts: [caller, { ...caller, id: "caller-2" }] },
    });
    render(<QuickAddCaller match={{ kind: "none", normalizedPhone: "" }} onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText("Name"), "Avery Example");
    await user.type(screen.getByLabelText("Organization or event"), "Marias Fair");
    await user.type(screen.getByLabelText("Phone"), "406-555-0101");
    await user.type(screen.getByLabelText("Reason for calling"), "Asked about an August event.");
    await user.click(screen.getByRole("button", { name: "Create caller" }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ phone: "406-555-0101" }));
    expect(screen.getByRole("heading", { name: "Choose the caller" })).toBeVisible();
    expect(screen.getAllByRole("link", { name: /Open .* in Call Workspace/ })).toHaveLength(2);
    expect(routerPush).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Back to caller details" }));
    expect(screen.getByLabelText("Name")).toHaveValue("Avery Example");
    expect(screen.getByLabelText("Organization or event")).toHaveValue("Marias Fair");
    expect(screen.getByLabelText("Phone")).toHaveValue("406-555-0101");
    expect(screen.getByLabelText("Reason for calling")).toHaveValue("Asked about an August event.");
  });

  it("makes Quick Add reachable from both responsive navigation variants", () => {
    render(<AppShell><p>Page content</p></AppShell>);

    const links = screen.getAllByRole("link", { name: "Quick Add caller" });
    expect(links).toHaveLength(2);
    for (const link of links) expect(link).toHaveAttribute("href", "/quick-add");
  });
});
