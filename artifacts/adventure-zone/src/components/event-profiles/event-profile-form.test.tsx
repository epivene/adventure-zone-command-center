// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EventProfileForm } from "./event-profile-form";

const navigate = vi.fn();
vi.mock("wouter", () => ({ useLocation: () => ["/event-profiles/new", navigate] }));

afterEach(() => {
  cleanup();
  navigate.mockReset();
});

describe("EventProfileForm", () => {
  it("creates a minimal lead with only a name and keeps the preselected family", async () => {
    const onSubmit = vi.fn(async () => ({ ok: true as const, profileId: "profile-1" }));
    render(
      <EventProfileForm
        events={[]}
        contacts={[]}
        families={[{ id: "family-1", name: "Fourth of July" }]}
        initialFamilyId="family-1"
        onSubmit={onSubmit}
      />,
    );

    fireEvent.change(screen.getByLabelText("Event / lead name"), { target: { value: "Miles City Celebration" } });
    fireEvent.click(screen.getByRole("button", { name: "Add Event / Lead" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      event: expect.objectContaining({ id: null, name: "Miles City Celebration", city: "", region: "" }),
      contacts: [],
      familyId: "family-1",
      booking: expect.objectContaining({ enabled: false }),
    })));
  });

  it("creates a name-only child for a preselected organization and hides existing-profile reuse", async () => {
    const onSubmit = vi.fn(async () => ({ ok: true as const, profileId: "profile-2" }));
    render(
      <EventProfileForm
        events={[{ id: "existing-1", name: "Existing Event", city: null, region: null }]}
        contacts={[]}
        initialOrganizationId="org-1"
        initialOrganizationName="Water Lantern Festival"
        onSubmit={onSubmit}
      />,
    );

    expect(screen.getByText("Part of Water Lantern Festival")).toBeInTheDocument();
    expect(screen.queryByLabelText("Use an existing profile")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Event / lead name"), { target: { value: "Denver Water Lantern Festival" } });
    fireEvent.click(screen.getByRole("button", { name: "Add Event / Lead" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      event: expect.objectContaining({ id: null, name: "Denver Water Lantern Festival" }),
      parentOrganizationId: "org-1",
      contacts: [],
    })));
  });

  it("keeps booking details collapsed and optional until selected", () => {
    render(<EventProfileForm events={[]} contacts={[]} onSubmit={vi.fn()} />);
    expect(screen.queryByText("Booking name")).not.toBeInTheDocument();
    expect(screen.getByText(/Booking & follow-up/)).toBeInTheDocument();
  });
});