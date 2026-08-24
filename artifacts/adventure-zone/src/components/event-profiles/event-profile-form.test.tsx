// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EventProfileForm } from "./event-profile-form";

const navigate = vi.fn();
vi.mock("wouter", () => ({ useLocation: () => ["/event-profiles/new", navigate] }));

afterEach(() => {
  cleanup();
  localStorage.clear();
  navigate.mockReset();
});

describe("EventProfileForm", () => {
  it("creates a minimal profile with only a name and keeps the preselected family", async () => {
    const onSubmit = vi.fn(async () => ({ ok: true as const, profileId: "profile-1" }));
    render(
      <EventProfileForm
        contacts={[]}
        families={[{ id: "family-1", name: "Fourth of July" }]}
        initialFamilyId="family-1"
        onSubmit={onSubmit}
      />,
    );

    fireEvent.change(screen.getByLabelText("Profile / event name"), { target: { value: "Miles City Celebration" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Profile" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      event: expect.objectContaining({ id: null, name: "Miles City Celebration", city: "", region: "" }),
      contacts: [],
      familyId: "family-1",
      booking: expect.objectContaining({ enabled: false }),
      profile: expect.objectContaining({ placeType: "festival_event", phone: "", website: "" }),
    })));
  });

  it("collects normal profile details before saving the profile", async () => {
    const onSubmit = vi.fn(async () => ({ ok: true as const, profileId: "profile-2" }));
    render(<EventProfileForm contacts={[]} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText("Profile / event name"), { target: { value: "Moab Music Festival" } });
    fireEvent.change(screen.getByLabelText("Profile type"), { target: { value: "festival_event" } });
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Annual community concert" } });
    fireEvent.change(screen.getByLabelText("Office phone"), { target: { value: "435-259-7003" } });
    fireEvent.change(screen.getByLabelText("Website"), { target: { value: "https://moabmusicfest.org" } });
    fireEvent.change(screen.getByLabelText("Venue address"), { target: { value: "100 Main St" } });
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "Moab" } });
    fireEvent.change(screen.getByLabelText("State"), { target: { value: "UT" } });
    fireEvent.change(screen.getByLabelText("ZIP code"), { target: { value: "84532" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Profile" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      event: expect.objectContaining({ name: "Moab Music Festival", city: "Moab", region: "UT" }),
      profile: expect.objectContaining({
        placeType: "festival_event",
        description: "Annual community concert",
        phone: "435-259-7003",
        website: "https://moabmusicfest.org",
        address1: "100 Main St",
        postalCode: "84532",
      }),
    })));
  });

  it("creates a child profile for a preselected organization", async () => {
    const onSubmit = vi.fn(async () => ({ ok: true as const, profileId: "profile-3" }));
    render(
      <EventProfileForm
        contacts={[]}
        initialOrganizationId="org-1"
        initialOrganizationName="Water Lantern Festival"
        onSubmit={onSubmit}
      />,
    );

    expect(screen.getByText("Part of Water Lantern Festival")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Profile / event name"), { target: { value: "Denver Water Lantern Festival" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Profile" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      event: expect.objectContaining({ id: null, name: "Denver Water Lantern Festival" }),
      parentOrganizationId: "org-1",
      contacts: [],
    })));
  });

  it("keeps booking details collapsed and optional until selected", () => {
    render(<EventProfileForm contacts={[]} onSubmit={vi.fn()} />);
    expect(screen.queryByText("Booking name")).not.toBeInTheDocument();
    expect(screen.getByText(/Booking & follow-up/)).toBeInTheDocument();
  });

  it("restores an unfinished local draft and can discard it", async () => {
    localStorage.setItem("adventure-zone:new-profile-draft:v1", JSON.stringify({
      eventName: "Recovered Fair",
      description: "Recovered description",
      placeType: "fair",
      phone: "",
      website: "",
      address1: "",
      address2: "",
      city: "Dickinson",
      region: "ND",
      postalCode: "",
      familyId: "",
      contacts: [{ id: "", name: "", phone: "", email: "", role: "", primary: true }],
      includeBooking: false,
      bookingName: "",
      travelLegId: "",
      nextActionKind: "call",
      nextActionDueAt: "",
      savedAt: "2026-08-24T23:00:00.000Z",
    }));

    render(<EventProfileForm contacts={[]} onSubmit={vi.fn()} />);

    expect(screen.getByDisplayValue("Recovered Fair")).toBeInTheDocument();
    expect(screen.getByText(/Recovered unfinished profile/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start over" }));
    await waitFor(() => expect(screen.getByLabelText("Profile / event name")).toHaveValue(""));
    expect(localStorage.getItem("adventure-zone:new-profile-draft:v1")).toBeNull();
  });
});