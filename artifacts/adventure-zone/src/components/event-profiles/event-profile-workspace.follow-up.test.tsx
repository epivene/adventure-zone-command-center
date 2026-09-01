import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("wouter", () => ({
  Link: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) => <a {...props}>{children}</a>,
}));

vi.mock("@/actions/activities", () => ({
  createActivityAction: vi.fn(),
  deleteActivityAction: vi.fn(),
  editActivityAction: vi.fn(),
  listActivityRevisionsAction: vi.fn(),
  loadTimelinePageAction: vi.fn(),
}));

import { EventProfileWorkspace } from "./event-profile-workspace";

afterEach(cleanup);

describe("EventProfileWorkspace profile follow-up creation", () => {
  it("accepts a typed YYYY-MM-DD date in the follow-up scheduler", async () => {
    const user = userEvent.setup();
    render(
      <EventProfileWorkspace
        profile={{
          id: "10000000-0000-4000-8000-000000000001",
          selectedContactId: "20000000-0000-4000-8000-000000000001",
          place: {
            id: "10000000-0000-4000-8000-000000000001",
            name: "Holly Gateway Fair",
            placeType: "event",
            phone: null,
            address1: null,
            address2: null,
            city: "Holly",
            region: "CO",
            postalCode: null,
            website: null,
            lastResort: false,
            lastResortReason: null,
            actRecordId: null,
          },
          contacts: [{
            id: "20000000-0000-4000-8000-000000000001",
            name: "Preston Neugebauer",
            role: "Contact",
            isPrimary: true,
            phone: "7196881182",
            email: null,
            source: "manual",
            actRecordId: null,
          }],
          bookings: [],
          notes: [],
          followUps: [],
          groups: [],
          sourceProvenance: [],
          assistedCallingEnabled: true,
        } as any}
        context={{ action: "follow-up" }}
      />,
    );

    expect(screen.getByLabelText("Follow-up type")).toBeVisible();
    expect(screen.getByLabelText("Due date")).toBeVisible();
    const dueDate = screen.getByLabelText("Due date");
    const save = screen.getByRole("button", { name: "Save follow-up" });
    expect(save).toBeDisabled();

    await user.type(dueDate, "2027-06-20");

    expect(dueDate).toHaveValue("2027-06-20");
    expect(save).toBeEnabled();
  });
});
