import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const apiGet = vi.hoisted(() => vi.fn());
const organizationId = "10000000-0000-4000-8000-000000000001";
const contactId = "20000000-0000-4000-8000-000000000001";
const bookingId = "30000000-0000-4000-8000-000000000001";

vi.mock("@/lib/auth-token", () => ({ apiGet }));
vi.mock("wouter", () => ({
  useParams: () => ({ profileId: organizationId }),
  useSearch: () => `?contactId=${contactId}&bookingId=${bookingId}`,
  Link: ({ href, children, ...props }: any) => <a href={href} {...props}>{children}</a>,
}));

import EventProfilePage from "./EventProfilePage";

const profile = {
  assistedCallingEnabled: true,
  id: organizationId,
  place: {
    id: organizationId,
    name: "Prairie Days",
    placeType: "event",
    phone: null,
    address1: null,
    address2: null,
    city: "Denver",
    region: "CO",
    postalCode: null,
    website: null,
    lastResort: false,
    lastResortReason: null,
    actRecordId: null,
  },
  contacts: [{
    id: contactId,
    name: "Sarah Miller",
    role: "Coordinator",
    isPrimary: true,
    phone: "303-555-0100",
    email: "sarah@example.com",
    source: "manual",
    actRecordId: null,
  }],
  selectedContactId: contactId,
  bookings: [{
    id: bookingId,
    name: "Prairie Days 2027",
    primaryContactId: contactId,
    city: "Denver",
    region: "CO",
    startsAt: null,
    endsAt: null,
    status: "prospect",
    probability: "warm",
    notes: null,
    actRecordId: null,
  }],
  notes: [],
  followUps: [],
  groups: [],
  sourceProvenance: [],
};

function contactDetail(doNotCallAt: string | null) {
  return {
    phones: [{ id: "phone-1", number: "303-555-0100", primary: true, doNotCallAt }],
  };
}

afterEach(() => {
  cleanup();
  apiGet.mockReset();
});

describe("EventProfilePage call actions", () => {
  it("hides assisted profile entry points when the shared flag is off", async () => {
    apiGet.mockImplementation((path: string) => path.startsWith("/event-profiles/")
      ? Promise.resolve({ ...profile, assistedCallingEnabled: false })
      : Promise.resolve(contactDetail(null)));
    render(<EventProfilePage />);
    expect(await screen.findByText("Assisted calling is not enabled.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Log call" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^Call$/ })).not.toBeInTheDocument();
  });

  it("preserves the contact, organization, and booking IDs in Call and Log call URLs", async () => {
    apiGet.mockImplementation((path: string) => path.startsWith("/event-profiles/")
      ? Promise.resolve(profile)
      : Promise.resolve(contactDetail(null)));
    render(<EventProfilePage />);

    const query = `organizationId=${organizationId}&contactId=${contactId}&bookingId=${bookingId}`;
    expect(await screen.findByRole("link", { name: "Call" })).toHaveAttribute("href", `/calls/new?${query}`);
    expect(screen.getByRole("link", { name: "Log call" })).toHaveAttribute("href", `/calls/log?${query}`);
  });

  it("suppresses call entry points for a Do Not Call contact but leaves Log call available", async () => {
    apiGet.mockImplementation((path: string) => path.startsWith("/event-profiles/")
      ? Promise.resolve(profile)
      : Promise.resolve(contactDetail("2026-08-12T12:00:00.000Z")));
    render(<EventProfilePage />);

    expect(await screen.findByRole("button", { name: "Call" })).toBeDisabled();
    expect(screen.queryByRole("link", { name: /^Call$/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Log call" })).toBeVisible();
    await waitFor(() => expect(screen.queryByRole("link", { name: /Call Sarah Miller/i })).not.toBeInTheDocument());
  });

  it("updates suppression when a different event contact is selected", async () => {
    const secondContactId = "20000000-0000-4000-8000-000000000002";
    const multipleContacts = {
      ...profile,
      contacts: [
        ...profile.contacts,
        { ...profile.contacts[0], id: secondContactId, name: "Blake North", phone: "303-555-0101", isPrimary: false },
      ],
    };
    apiGet.mockImplementation((path: string) => {
      if (path.startsWith("/event-profiles/")) return Promise.resolve(multipleContacts);
      return Promise.resolve(contactDetail(path.endsWith(secondContactId) ? "2026-08-12T12:00:00.000Z" : null));
    });
    render(<EventProfilePage />);

    expect(await screen.findByRole("link", { name: "Call" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Blake North" }));
    expect(screen.getByRole("button", { name: "Call" })).toBeDisabled();
    expect(screen.getByRole("link", { name: "Log call" })).toBeVisible();
  });

  it("calls the exact unsuppressed number when a contact has mixed phone suppression", async () => {
    apiGet.mockImplementation((path: string) => {
      if (path.startsWith("/event-profiles/")) return Promise.resolve(profile);
      return Promise.resolve({
        phones: [
          { id: "phone-1", number: "303-555-0100", primary: true, doNotCallAt: "2026-08-12T12:00:00.000Z" },
          { id: "phone-2", number: "720-555-0199", primary: false, doNotCallAt: null },
        ],
      });
    });
    render(<EventProfilePage />);

    expect(await screen.findByRole("link", { name: "Call" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Call Sarah Miller" })).toHaveAttribute("href", "tel:7205550199");
    expect(screen.getByRole("link", { name: "Log call" })).toBeVisible();
  });

  it("fails closed for direct calling when authoritative phone details cannot load", async () => {
    apiGet.mockImplementation((path: string) => path.startsWith("/event-profiles/")
      ? Promise.resolve(profile)
      : Promise.reject(new Error("contact unavailable")));
    render(<EventProfilePage />);

    expect(await screen.findByRole("button", { name: "Call" })).toBeDisabled();
    expect(screen.queryByRole("link", { name: "Call Sarah Miller" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Log call" })).toBeVisible();
  });
});

describe("EventProfilePage recovered ACT history", () => {
  it("shows migration notes that were preserved during profile merges", async () => {
    apiGet.mockImplementation((path: string) => path.startsWith("/event-profiles/")
      ? Promise.resolve({
          ...profile,
          migrationHistory: {
            contactSourceIds: [],
            phones: [],
            notes: ["Called in 2023 — interested in the full package.", "Old ACT history: sent pricing."],
            bookingSourceIds: [],
            groupSourceIds: [],
          },
        })
      : Promise.resolve(contactDetail(null)));

    render(<EventProfilePage />);

    expect(await screen.findByRole("heading", { name: "Recovered ACT notes & history" })).toBeVisible();
    expect(screen.getByText("Called in 2023 — interested in the full package.")).toBeVisible();
    expect(screen.getByText("Old ACT history: sent pricing.")).toBeVisible();
  });

  it("does not show a recovered section when no preserved ACT notes exist", async () => {
    apiGet.mockImplementation((path: string) => path.startsWith("/event-profiles/")
      ? Promise.resolve(profile)
      : Promise.resolve(contactDetail(null)));

    render(<EventProfilePage />);

    expect(await screen.findByText("Prairie Days")).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Recovered ACT notes & history" })).not.toBeInTheDocument();
  });
});
