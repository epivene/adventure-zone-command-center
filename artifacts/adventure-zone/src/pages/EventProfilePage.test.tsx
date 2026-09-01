import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const apiGet = vi.hoisted(() => vi.fn());
const apiPatch = vi.hoisted(() => vi.fn());
const setLocation = vi.hoisted(() => vi.fn());
const organizationId = "10000000-0000-4000-8000-000000000001";
const contactId = "20000000-0000-4000-8000-000000000001";
const bookingId = "30000000-0000-4000-8000-000000000001";

vi.mock("@/lib/auth-token", () => ({ apiGet, apiPatch }));
vi.mock("@/features/assistant/assistant-context", () => ({
  useAssistantContext: () => ({ openAssistant: vi.fn() }),
}));
vi.mock("@/components/assistant/assistant-context-registration", () => ({
  AssistantContextRegistration: () => null,
}));
vi.mock("wouter", () => ({
  useParams: () => ({ profileId: organizationId }),
  useSearch: () => `?contactId=${contactId}&bookingId=${bookingId}`,
  useLocation: () => [`/profiles/${organizationId}`, setLocation],
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

function profileApi(path: string, value: any = profile) {
  if (path === `/event-profiles/${organizationId}/photo`) return Promise.resolve({ dataUrl: null });
  if (path === `/event-profiles/${organizationId}/description`) return Promise.resolve({ description: value.place?.description ?? null });
  if (path.startsWith(`/event-profiles/${organizationId}`)) return Promise.resolve(value);
  if (path === `/event-wrap-up-ratings/organization/${organizationId}`) return Promise.resolve({ average: null, count: 0 });
  return Promise.resolve(contactDetail(null));
}

afterEach(() => {
  cleanup();
  apiGet.mockReset();
  apiPatch.mockReset();
  setLocation.mockReset();
});

describe("EventProfilePage About section", () => {
  it("shows the complete saved event description on the profile page", async () => {
    const describedProfile = {
      ...profile,
      place: {
        ...profile.place,
        description: "A full event description that visitors can read without opening Edit.",
      },
    };
    apiGet.mockImplementation((path: string) => profileApi(path, describedProfile));
    render(<EventProfilePage />);

    expect((await screen.findAllByRole("heading", { name: "About" })).length).toBeGreaterThan(0);
    expect((await screen.findAllByText("A full event description that visitors can read without opening Edit.")).length).toBeGreaterThan(0);
  });

  it("does not show an empty About section", async () => {
    apiGet.mockImplementation((path: string) => profileApi(path));
    render(<EventProfilePage />);

    expect((await screen.findAllByText("Prairie Days")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("heading", { name: "About" })).not.toBeInTheDocument();
  });
});

describe("EventProfilePage navigation", () => {
  it("shows a Back button on a loaded profile", async () => {
    apiGet.mockImplementation((path: string) => profileApi(path));
    render(<EventProfilePage />);
    expect(await screen.findByRole("button", { name: "Back" })).toBeVisible();
  });

  it("turns Back into Back to profile while inline edit is open", async () => {
    apiGet.mockImplementation((path: string) => profileApi(path));
    render(<EventProfilePage />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const back = screen.getByRole("button", { name: "Back" });
    expect(back).toHaveTextContent("Back to profile");
    fireEvent.click(back);
    expect(await screen.findByRole("button", { name: "Edit" })).toBeVisible();
    expect(setLocation).not.toHaveBeenCalled();
  });
});

describe("EventProfilePage call actions", () => {
  it("hides assisted profile entry points when the shared flag is off", async () => {
    apiGet.mockImplementation((path: string) => profileApi(path, { ...profile, assistedCallingEnabled: false }));
    render(<EventProfilePage />);
    expect(await screen.findByText("Assisted calling is not enabled.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Log call" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^Call$/ })).not.toBeInTheDocument();
  });

  it("preserves the contact, organization, and booking IDs in Call and Log call URLs", async () => {
    apiGet.mockImplementation((path: string) => profileApi(path));
    render(<EventProfilePage />);
    const query = `organizationId=${organizationId}&contactId=${contactId}&bookingId=${bookingId}`;
    expect(await screen.findByRole("link", { name: "Call" })).toHaveAttribute("href", `/calls/new?${query}`);
    expect(screen.getByRole("link", { name: "Log call" })).toHaveAttribute("href", `/calls/log?${query}`);
  });

  it("suppresses call entry points for a Do Not Call contact but leaves Log call available", async () => {
    apiGet.mockImplementation((path: string) => {
      if (path === `/event-profiles/${organizationId}/photo`) return Promise.resolve({ dataUrl: null });
      if (path.startsWith(`/event-profiles/${organizationId}`)) return Promise.resolve(profile);
      if (path === `/event-wrap-up-ratings/organization/${organizationId}`) return Promise.resolve({ average: null, count: 0 });
      return Promise.resolve(contactDetail("2026-08-12T12:00:00.000Z"));
    });
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
      if (path === `/event-profiles/${organizationId}/photo`) return Promise.resolve({ dataUrl: null });
      if (path.startsWith(`/event-profiles/${organizationId}`)) return Promise.resolve(multipleContacts);
      if (path === `/event-wrap-up-ratings/organization/${organizationId}`) return Promise.resolve({ average: null, count: 0 });
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
      if (path === `/event-profiles/${organizationId}/photo`) return Promise.resolve({ dataUrl: null });
      if (path.startsWith(`/event-profiles/${organizationId}`)) return Promise.resolve(profile);
      if (path === `/event-wrap-up-ratings/organization/${organizationId}`) return Promise.resolve({ average: null, count: 0 });
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
    apiGet.mockImplementation((path: string) => {
      if (path === `/event-profiles/${organizationId}/photo`) return Promise.resolve({ dataUrl: null });
      if (path.startsWith(`/event-profiles/${organizationId}`)) return Promise.resolve(profile);
      if (path === `/event-wrap-up-ratings/organization/${organizationId}`) return Promise.resolve({ average: null, count: 0 });
      return Promise.reject(new Error("contact unavailable"));
    });
    render(<EventProfilePage />);
    expect(await screen.findByRole("button", { name: "Call" })).toBeDisabled();
    expect(screen.queryByRole("link", { name: "Call Sarah Miller" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Log call" })).toBeVisible();
  });
});

describe("EventProfilePage recovered ACT history", () => {
  it("keeps recovered ACT notes in a collapsed searchable section", async () => {
    const recoveredProfile = {
      ...profile,
      migrationHistory: {
        contactSourceIds: [],
        phones: [],
        notes: ["Called in 2023 — interested in the full package.", "Old ACT history: sent pricing."],
        bookingSourceIds: [],
        groupSourceIds: [],
      },
    };
    apiGet.mockImplementation((path: string) => profileApi(path, recoveredProfile));
    render(<EventProfilePage />);

    const summary = await screen.findByText("Imported ACT history (2)");
    expect(summary).toBeVisible();
    fireEvent.click(summary);
    expect(screen.getByLabelText("Search imported ACT history")).toBeVisible();
    expect(screen.getByText("Called in 2023 — interested in the full package.")).toBeVisible();
    expect(screen.getByText("Old ACT history: sent pricing.")).toBeVisible();
  });

  it("does not show imported ACT history when none exists", async () => {
    apiGet.mockImplementation((path: string) => profileApi(path));
    render(<EventProfilePage />);
    expect(await screen.findByText("Prairie Days")).toBeVisible();
    expect(screen.queryByText(/Imported ACT history/)).not.toBeInTheDocument();
  });
});

describe("EventProfilePage ratings", () => {
  it("shows a zero-star rating summary even before the first rating exists", async () => {
    apiGet.mockImplementation((path: string) => profileApi(path));
    render(<EventProfilePage />);
    expect(await screen.findByText("☆☆☆☆☆")).toBeVisible();
    expect(screen.getByText("0.0")).toBeVisible();
    expect(screen.getByText("0 rated occurrences")).toBeVisible();
  });
});
