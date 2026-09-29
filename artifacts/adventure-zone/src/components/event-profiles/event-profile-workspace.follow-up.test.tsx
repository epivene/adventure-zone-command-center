import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

const profile = {
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
} as any;

describe("EventProfileWorkspace profile follow-up creation", () => {
  it("exposes keyboard-friendly MM/DD/YYYY entry in the follow-up scheduler", () => {
    render(<EventProfileWorkspace profile={profile} context={{ action: "follow-up" }} />);

    expect(screen.getByLabelText("Follow-up type")).toBeVisible();
    expect(screen.getByLabelText("Due date")).toBeVisible();
    const dueDate = screen.getByLabelText("Due date");
    const save = screen.getByRole("button", { name: "Save follow-up" });
    expect(save).toBeDisabled();

    expect(dueDate).toHaveAttribute("inputmode", "numeric");
    expect(dueDate).toHaveAttribute("placeholder", "MM/DD/YYYY");
    fireEvent.change(dueDate, { target: { value: "06/20/2027" } });

    expect(dueDate).toHaveValue("06/20/2027");
    expect(save).toBeEnabled();
  });

  it("offers the shared operational follow-up reasons", () => {
    render(<EventProfileWorkspace profile={profile} context={{ action: "follow-up" }} />);

    for (const label of [
      "2027 outreach",
      "Post-event feedback",
      "Convention reply check",
      "Proposal / contract",
      "Application deadline",
      "Deposit / payment",
      "Awaiting decision",
      "Contact repair",
    ]) {
      expect(screen.getByRole("option", { name: label })).toBeVisible();
    }
  });
});
