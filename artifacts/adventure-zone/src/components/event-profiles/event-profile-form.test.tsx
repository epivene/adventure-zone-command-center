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

  it("keeps booking details collapsed and optional until selected", () => {
    render(<EventProfileForm events={[]} contacts={[]} onSubmit={vi.fn()} />);
    expect(screen.queryByText("Booking name")).not.toBeInTheDocument();
    expect(screen.getByText(/Booking & follow-up/)).toBeInTheDocument();
  });
});
