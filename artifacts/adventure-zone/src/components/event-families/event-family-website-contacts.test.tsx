// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ apiGet: vi.fn(), apiPatch: vi.fn(), apiPost: vi.fn(), apiDelete: vi.fn() }));
vi.mock("@/lib/auth-token", () => ({ apiGet: mocks.apiGet, apiPatch: mocks.apiPatch, apiPost: mocks.apiPost, apiDelete: mocks.apiDelete }));

import { EventFamilyWebsiteContacts } from "./event-family-website-contacts";

const family = {
  id: "family-1", name: "Water Lantern Festival", normalizedName: "water lantern festival", description: null,
  website: "waterlanternfestival.com", memberCount: 2, members: [],
  contacts: [{ id: "link-1", contactId: "contact-1", name: "Jane Smith", firstName: "Jane", lastName: "Smith", phone: "701-555-0101", email: "jane@example.com", role: "Corporate Events", isPrimary: true }],
};

afterEach(cleanup);
beforeEach(() => { Object.values(mocks).forEach((mock) => mock.mockReset()); vi.spyOn(window, "confirm").mockReturnValue(true); });

describe("EventFamilyWebsiteContacts", () => {
  it("shows and edits the family website", async () => {
    mocks.apiPatch.mockResolvedValue({ ok: true });
    const onChanged = vi.fn();
    render(<EventFamilyWebsiteContacts family={family as any} onChanged={onChanged} />);
    expect(screen.getByRole("link", { name: "Visit website" })).toHaveAttribute("href", "https://waterlanternfestival.com");
    fireEvent.click(screen.getByRole("button", { name: "Edit website" }));
    fireEvent.change(screen.getByLabelText("Family website"), { target: { value: "https://example.org" } });
    fireEvent.click(screen.getByRole("button", { name: "Save website" }));
    await waitFor(() => expect(mocks.apiPatch).toHaveBeenCalledWith("/event-families/family-1/website", { website: "https://example.org" }));
    expect(onChanged).toHaveBeenCalled();
  });

  it("shows family contacts and can attach an existing CRM contact", async () => {
    mocks.apiGet.mockResolvedValue({ contacts: [{ id: "contact-2", name: "Alex Lee", phone: "701-555-0102", email: "alex@example.com" }] });
    mocks.apiPost.mockResolvedValue({ ok: true });
    render(<EventFamilyWebsiteContacts family={family as any} onChanged={vi.fn()} />);
    expect(screen.getByText("Jane Smith")).toBeInTheDocument();
    expect(screen.getByText("Primary")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "+ Add contact" }));
    fireEvent.change(screen.getByLabelText("Search existing contacts"), { target: { value: "Alex" } });
    fireEvent.click(screen.getByRole("button", { name: "Search contacts" }));
    await screen.findByText("Alex Lee");
    fireEvent.click(screen.getByRole("button", { name: /Alex Lee/ }));
    fireEvent.click(screen.getByRole("button", { name: "Attach contact" }));
    await waitFor(() => expect(mocks.apiPost).toHaveBeenCalledWith("/event-families/family-1/contacts", expect.objectContaining({ contactId: "contact-2" })));
  });

  it("creates a new name-only CRM contact, updates Primary, and removes only the family link", async () => {
    mocks.apiPost.mockResolvedValue({ ok: true });
    mocks.apiPatch.mockResolvedValue({ ok: true });
    mocks.apiDelete.mockResolvedValue({ ok: true });
    render(<EventFamilyWebsiteContacts family={family as any} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "+ Add contact" }));
    fireEvent.click(screen.getByRole("button", { name: "Create new contact" }));
    fireEvent.change(screen.getByLabelText("Contact name"), { target: { value: "Morgan Ray" } });
    fireEvent.click(screen.getByRole("button", { name: "Create and attach" }));
    await waitFor(() => expect(mocks.apiPost).toHaveBeenCalledWith("/event-families/family-1/contacts/new", expect.objectContaining({ name: "Morgan Ray" })));

    fireEvent.click(screen.getByRole("button", { name: "Edit family contact Jane Smith" }));
    fireEvent.click(screen.getByLabelText("Primary family contact"));
    fireEvent.click(screen.getByRole("button", { name: "Save family contact" }));
    await waitFor(() => expect(mocks.apiPatch).toHaveBeenCalledWith("/event-families/family-1/contacts/contact-1", expect.objectContaining({ isPrimary: true })));

    fireEvent.click(screen.getByRole("button", { name: "Remove Jane Smith from family" }));
    await waitFor(() => expect(mocks.apiDelete).toHaveBeenCalledWith("/event-families/family-1/contacts/contact-1"));
    expect(mocks.apiDelete).not.toHaveBeenCalledWith("/contacts/contact-1");
  });

  it("keeps server errors visible", async () => {
    mocks.apiPatch.mockRejectedValue(new Error("Could not save family website"));
    render(<EventFamilyWebsiteContacts family={family as any} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit website" }));
    fireEvent.click(screen.getByRole("button", { name: "Save website" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Could not save family website/i);
  });
});
