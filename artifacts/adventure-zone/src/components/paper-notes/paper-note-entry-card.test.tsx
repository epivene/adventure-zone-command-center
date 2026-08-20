import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PaperNoteEntryCard } from "./paper-note-entry-card";

const entry = {
  id: "30000000-0000-4000-8000-000000000001",
  reviewVersion: 2,
  state: "needs_review" as const,
  approvedAt: null,
  validationIssues: [{ fieldPath: "destination", message: "Choose where this paper entry belongs before approving it.", severity: "blocking" as const }],
  extraction: {
    transcription: "Emmett Cherry Festival — Tina — ext 3115 — call Monday ★",
  },
  review: {
    event: { name: "Emmett Cherry Festival", city: "Emmett", region: "ID", venue: "", eventDateText: "", startsOn: null, endsOn: null, pageYearConfirmed: false },
    activity: { occurredOn: "2026-04-21", method: "call" as const, outcome: "No room this year", summary: "Spoke with Tina." },
    contacts: [{
      key: "contact-0",
      mode: "new_contact" as const,
      selectedContactId: null,
      name: "Tina",
      role: null,
      email: null,
      primary: true,
      phones: [{
        key: "phone-0",
        number: "208-555-0142",
        extension: "3115",
        type: "office" as const,
        label: "fair office",
        instructions: null,
        status: "active" as const,
        primary: true,
        crossedOut: false,
        importAsStructuredValue: true,
      }],
    }],
    organizationPhones: [],
    oldReminder: "Call Monday",
    starredOnPaper: true,
    generalNotes: [],
    destination: null,
    conflicts: {},
    currentFollowUp: { enabled: false, kind: "call", dueOn: null, contactKey: null },
  },
};

describe("PaperNoteEntryCard", () => {
  it("shows the paper evidence and keeps phone extension/reminder/star meaning explicit", () => {
    render(<PaperNoteEntryCard
      entry={entry as any}
      matches={[]}
      loadSource={vi.fn()}
      onSave={vi.fn()}
      onApprove={vi.fn()}
      onUnapprove={vi.fn()}
      onSkip={vi.fn()}
    />);

    expect(screen.getByText(/Emmett Cherry Festival — Tina — ext 3115/)).toBeInTheDocument();
    expect(screen.getByLabelText("Phone number")).toHaveValue("208-555-0142");
    expect(screen.getByLabelText("Extension")).toHaveValue("3115");
    expect(screen.getByLabelText("Old reminder from paper")).toHaveValue("Call Monday");
    expect(screen.getByLabelText("Starred on original paper")).toBeChecked();
    expect(screen.getByRole("button", { name: "Create new profile" })).toBeInTheDocument();
  });

  it("explains why an existing profile was suggested", () => {
    render(<PaperNoteEntryCard
      entry={entry as any}
      matches={[{
        organizationId: "10000000-0000-4000-8000-000000000001",
        organizationLocationId: null,
        name: "Emmett Cherry Festival",
        city: "Emmett",
        region: "ID",
        strength: "strong",
        score: 200,
        reasons: ["same phone number and extension", "same event/profile name and city/state"],
      }]}
      loadSource={vi.fn()}
      onSave={vi.fn()}
      onApprove={vi.fn()}
      onUnapprove={vi.fn()}
      onSkip={vi.fn()}
    />);
    expect(screen.getByText("same phone number and extension")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use Emmett Cherry Festival" })).toBeInTheDocument();
  });
});
