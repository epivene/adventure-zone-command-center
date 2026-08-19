import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { LeadScoutCandidate } from "@/features/assistant/assistant-types";
import { LeadScoutSaveDialog } from "./lead-scout-save-dialog";

const candidate: LeadScoutCandidate = {
  id: "candidate-1",
  name: "Silver Valley Days",
  city: "Kellogg",
  region: "ID",
  venue: "Downtown",
  startsAt: "2026-09-11",
  endsAt: "2026-09-13",
  organizerName: "Jamie Organizer",
  organizerEmail: "jamie@example.org",
  organizerPhone: "208-555-0100",
  website: "https://example.org/silver-valley-days",
  eventType: "community festival",
  recurrenceSummary: "Annual September festival",
  attendanceSummary: "About 8,000 attendees",
  vendorSummary: "Vendor applications open",
  applicationDeadline: "2026-06-01",
  fitScore: 88,
  fitRationale: "Strong family fit",
  fitReasons: ["family audience", "vendor path"],
  fitCautions: ["Confirm power"],
  crmMatchStatus: "new_prospect",
  matchedOrganizationId: null,
  matchedBookingId: null,
  reviewStatus: "unreviewed",
  enrichmentStatus: "enriched",
  coverageGaps: ["Power requirements not published"],
  enrichmentError: null,
  enrichedAt: "2026-08-19T18:10:00.000Z",
  deepenRequestedAt: null,
  savedOrganizationId: null,
  savedBookingId: null,
  facts: [{ id: "fact-1", key: "attendance", value: "8,000", category: "attendance", confidence: "medium", rationale: "News recap", sourceIds: ["source-1"] }],
};

describe("LeadScoutSaveDialog", () => {
  it("prefills researched structured fields but keeps them editable", () => {
    render(<LeadScoutSaveDialog candidate={candidate} onClose={vi.fn()} onSave={vi.fn()} />);

    expect(screen.getByLabelText("Lead name")).toHaveValue("Silver Valley Days");
    expect(screen.getByLabelText("City")).toHaveValue("Kellogg");
    expect(screen.getByLabelText("State")).toHaveValue("ID");
    expect(screen.getByLabelText("Start date")).toHaveValue("2026-09-11");
    expect(screen.getByLabelText("Website")).toHaveValue("https://example.org/silver-valley-days");
    expect(screen.getByLabelText("Contact name")).toHaveValue("Jamie Organizer");

    fireEvent.change(screen.getByLabelText("Lead name"), { target: { value: "Silver Valley Days & Family Fest" } });
    expect(screen.getByLabelText("Lead name")).toHaveValue("Silver Valley Days & Family Fest");
  });

  it("keeps Save as lead disabled until first action and follow-up date are chosen", () => {
    render(<LeadScoutSaveDialog candidate={candidate} onClose={vi.fn()} onSave={vi.fn()} />);
    const save = screen.getByRole("button", { name: "Save as lead" });
    expect(save).toHaveProperty("disabled", true);

    fireEvent.change(screen.getByLabelText("First action"), { target: { value: "call" } });
    expect(save).toHaveProperty("disabled", true);
    fireEvent.change(screen.getByLabelText("First follow-up date"), { target: { value: "2026-08-24" } });
    expect(save).toHaveProperty("disabled", false);
  });

  it("sends only accepted structured fields plus the chosen first action", async () => {
    const onSave = vi.fn(async () => ({ kind: "created", profileId: "profile-1", bookingId: "booking-1", run: { id: "run-1" } } as any));
    const onClose = vi.fn();
    render(<LeadScoutSaveDialog candidate={candidate} onClose={onClose} onSave={onSave} />);

    fireEvent.change(screen.getByLabelText("Lead name"), { target: { value: "Edited Event Name" } });
    fireEvent.change(screen.getByLabelText("First action"), { target: { value: "prepare_quote" } });
    fireEvent.change(screen.getByLabelText("First follow-up date"), { target: { value: "2026-08-24" } });
    fireEvent.click(screen.getByRole("button", { name: "Save as lead" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith({
      accepted: {
        name: "Edited Event Name",
        city: "Kellogg",
        region: "ID",
        startsAt: "2026-09-11",
        endsAt: "2026-09-13",
        website: "https://example.org/silver-valley-days",
        contactName: "Jamie Organizer",
        contactEmail: "jamie@example.org",
        contactPhone: "208-555-0100",
      },
      nextActionKind: "prepare_quote",
      nextActionDueAt: "2026-08-24",
    });
    expect(JSON.stringify(onSave.mock.calls[0]?.[0])).not.toContain("8,000");
    expect(JSON.stringify(onSave.mock.calls[0]?.[0])).not.toContain("Power requirements");
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("keeps a duplicate result in review mode instead of claiming creation", async () => {
    const onSave = vi.fn(async () => ({
      kind: "duplicate",
      match: { status: "possible_match", organizationId: "existing-org", bookingId: "existing-booking", matchedName: "Silver Valley Days" },
      run: { id: "run-1" },
    } as any));
    render(<LeadScoutSaveDialog candidate={candidate} onClose={vi.fn()} onSave={onSave} />);

    fireEvent.change(screen.getByLabelText("First action"), { target: { value: "email" } });
    fireEvent.change(screen.getByLabelText("First follow-up date"), { target: { value: "2026-08-24" } });
    fireEvent.click(screen.getByRole("button", { name: "Save as lead" }));

    await waitFor(() => expect(screen.getByText(/possible match already exists/i)).toBeTruthy());
    expect(screen.getByRole("link", { name: "Review existing profile" })).toHaveAttribute("href", "/profiles/existing-org");
    expect(screen.queryByText(/saved to command center/i)).toBeNull();
  });
});
