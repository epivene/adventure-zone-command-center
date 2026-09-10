import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  bossGet: vi.fn(),
  bossPatch: vi.fn(),
  bossPut: vi.fn(),
}));

vi.mock("@/lib/boss-auth-context", () => ({
  bossGet: mocks.bossGet,
  bossPatch: mocks.bossPatch,
  bossPut: mocks.bossPut,
}));
vi.mock("@/components/profiles/convention-history", () => ({ ConventionHistory: () => null }));
vi.mock("@/components/boss/boss-profile-emails", () => ({ BossProfileEmails: () => null }));
vi.mock("wouter", () => ({
  Link: ({ href, children, ...props }: any) => <a href={href} {...props}>{children}</a>,
  useLocation: () => ["/boss", vi.fn()],
}));

import BossContactDetailPage from "./BossContactDetailPage";
import BossProfilePage from "./BossProfilePage";

const profileId = "10000000-0000-4000-8000-000000000001";
const contactId = "10000000-0000-4000-8000-000000000002";
const profile = {
  id: profileId,
  name: "County Fair",
  description: "Annual fair",
  profileImageDataUrl: null,
  phone: "701-555-0100",
  address1: "1 Main St",
  address2: null,
  city: "Dickinson",
  region: "ND",
  postalCode: "58601",
  website: null,
  contacts: [],
  bookings: [],
  notes: [],
  locations: [],
};
const contactDetail = {
  contact: {
    id: contactId,
    firstName: "Sam",
    lastName: "Taylor",
    organizationName: "County Fair",
    jobTitle: "Director",
    email: "sam@example.com",
    phone: "701-555-0100",
    address1: "1 Main St",
    address2: null,
    city: "Dickinson",
    region: "ND",
    postalCode: "58601",
  },
  places: [
    { id: profileId, name: "County Fair", role: "Director", isPrimaryPlace: true, active: true },
    { id: "10000000-0000-4000-8000-000000000003", name: "Fall Festival", role: "Organizer", isPrimaryPlace: false, active: true },
  ],
  phones: [{ id: null, number: "701-555-0100", type: "office", extension: null, label: null, primary: true }],
  relatedBookings: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.bossPatch.mockResolvedValue({ ok: true });
  mocks.bossPut.mockResolvedValue({ ok: true });
});
afterEach(cleanup);

describe("Dave profile and contact pages", () => {
  it("lets Dave edit and save an event profile", async () => {
    mocks.bossGet.mockResolvedValue({ profile });
    render(<BossProfilePage profileId={profileId} />);

    fireEvent.click(await screen.findByRole("button", { name: "Edit Profile" }));
    fireEvent.change(screen.getByLabelText("Profile name"), { target: { value: "Updated County Fair" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mocks.bossPatch).toHaveBeenCalledWith(
      `/boss/profiles/${profileId}`,
      expect.objectContaining({ name: "Updated County Fair" }),
    ));
  });

  it("shows every connected profile as a clickable link on the contact page", async () => {
    mocks.bossGet.mockResolvedValue(contactDetail);
    render(<BossContactDetailPage contactId={contactId} />);

    expect(await screen.findByRole("link", { name: /County Fair/ })).toHaveAttribute("href", `/boss/profiles/${profileId}`);
    expect(screen.getByRole("link", { name: /Fall Festival/ })).toHaveAttribute("href", "/boss/profiles/10000000-0000-4000-8000-000000000003");
  });

  it("opens Dave's contact editor with the current contact details", async () => {
    mocks.bossGet.mockResolvedValue(contactDetail);
    render(<BossContactDetailPage contactId={contactId} />);

    fireEvent.click(await screen.findByRole("button", { name: "Edit Contact" }));
    expect(screen.getByLabelText("Job title")).toHaveValue("Director");
    expect(screen.getByRole("button", { name: "Save contact" })).toBeInTheDocument();
  });
});
