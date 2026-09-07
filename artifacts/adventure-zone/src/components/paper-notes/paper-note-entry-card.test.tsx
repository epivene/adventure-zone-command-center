import { fireEvent, render, screen } from "@testing-library/react";
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
      role: "Event coordinator",
      email: null,
      primary: true,
      phones: [{
        key: "phone-0",
        number: "208-555-0142",
        extension: "3115",
        type: "office" as const,
        label: "fair office",
        instructions: "Ask for Tina",
        status: "active" as const,
        primary: true,
        crossedOut: false,
        importAsStructuredValue: true,
      }],
    }],
    organizationPhones: [{
      key: "org-phone-0",
      number: "208-555-0100",
      extension: null,
      type: "office" as const,
      label: "main office",
      instructions: "Call main office",
      status: "active" as const,
      primary: false,
      crossedOut: false,
      importAsStructuredValue: true,
    }],
    oldReminder: "Call Monday",
    starredOnPaper: true,
    generalNotes: [],
    destination: null,
    conflicts: {},
    currentFollowUp: { enabled: false, kind: "call", dueOn: null, contactKey: null },
  },
};

const existingMatch = {
  organizationId: "10000000-0000-4000-8000-000000000001",
  organizationLocationId: null,
  name: "Emmett Cherry Festival",
  city: "Emmett",
  region: "ID",
  strength: "strong" as const,
  score: 200,
  reasons: ["same phone number and extension", "same event/profile name and city/state"],
  contacts: [{
    id: "50000000-0000-4000-8000-000000000001",
    name: "Tina Smith",
    role: "Event coordinator",
    email: "tina@example.test",
    phones: [{
      id: "60000000-0000-4000-8000-000000000001",
      number: "208-555-0142",
      extension: "3115",
      type: "office" as const,
      label: "office",
      instructions: null,
      status: "active" as const,
      primary: true,
    }],
  }],
  organizationPhones: [{
    id: "70000000-0000-4000-8000-000000000001",
    organizationLocationId: null,
    number: "208-555-0100",
    extension: null,
    type: "office" as const,
    label: "main office",
    instructions: null,
    status: "active" as const,
    primary: true,
  }],
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
    expect(screen.getByLabelText(/^Phone type$/i)).toHaveValue("office");
    expect(screen.getByLabelText("Phone label")).toHaveValue("fair office");
    expect(screen.getByLabelText("Phone status")).toHaveValue("active");
    expect(screen.getByLabelText("Import as structured phone")).toBeChecked();
    expect(screen.getByLabelText("Primary phone")).toBeChecked();
    expect(screen.getByLabelText("Organization primary phone")).not.toBeChecked();
    expect(screen.getByLabelText("Old reminder from paper")).toHaveValue("Call Monday");
    expect(screen.getByLabelText("Starred on original paper")).toBeChecked();
    expect(screen.getByText("Organization / main office phones")).toBeInTheDocument();
    expect(screen.getByDisplayValue("208-555-0100")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create new profile" })).toBeInTheDocument();
  });

  it("shows every general paper note for correction and warns when the entry may continue", () => {
    render(<PaperNoteEntryCard
      entry={{
        ...entry,
        extraction: { ...entry.extraction, mayContinue: true },
        review: {
          ...entry.review,
          generalNotes: ["Sent packet last year", "Use north gate"],
        },
      } as any}
      matches={[]}
      loadSource={vi.fn()}
      onSave={vi.fn()}
      onApprove={vi.fn()}
      onUnapprove={vi.fn()}
      onSkip={vi.fn()}
    />);

    expect(screen.getByText(/may continue elsewhere/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Other paper note 1")).toHaveValue("Sent packet last year");
    expect(screen.getByLabelText("Other paper note 2")).toHaveValue("Use north gate");
    fireEvent.change(screen.getByLabelText("Other paper note 2"), {
      target: { value: "Use north entrance" },
    });
    expect(screen.getByLabelText("Other paper note 2")).toHaveValue("Use north entrance");
  });

  it("lets the reviewer choose the type, date, and reviewed contact for a new current follow-up", () => {
    render(<PaperNoteEntryCard
      entry={entry as any}
      matches={[]}
      loadSource={vi.fn()}
      onSave={vi.fn()}
      onApprove={vi.fn()}
      onUnapprove={vi.fn()}
      onSkip={vi.fn()}
    />);

    fireEvent.click(screen.getByLabelText("Create a current follow-up"));
    expect(screen.getByLabelText("Current follow-up type")).toHaveValue("call");
    expect(screen.getByLabelText("New current follow-up date")).toBeInTheDocument();
    expect(screen.getByLabelText("Current follow-up contact")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Tina/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Use primary reviewed contact/i })).toBeInTheDocument();
  });

  it("automatically links a uniquely matching saved contact when the existing profile is chosen", () => {
    render(<PaperNoteEntryCard
      entry={entry as any}
      matches={[existingMatch] as any}
      loadSource={vi.fn()}
      onSave={vi.fn()}
      onApprove={vi.fn()}
      onUnapprove={vi.fn()}
      onSkip={vi.fn()}
    />);
    expect(screen.getByText("same phone number and extension")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Use Emmett Cherry Festival" }));
    expect(screen.getByLabelText("Contact handling")).toHaveValue("existing_contact");
    expect(screen.getByLabelText("Existing contact")).toHaveValue("50000000-0000-4000-8000-000000000001");
    expect(screen.getByRole("option", { name: /Tina Smith/ })).toBeInTheDocument();
  });

  it("lets the reviewer confirm an inferred event year and create a new location under a saved profile", () => {
    render(<PaperNoteEntryCard
      entry={{
        ...entry,
        review: {
          ...entry.review,
          event: {
            ...entry.review.event,
            eventDateText: "June 22",
            startsOn: "2026-06-22",
            endsOn: "2026-06-23",
            pageYearConfirmed: false,
          },
        },
      } as any}
      matches={[existingMatch] as any}
      loadSource={vi.fn()}
      onSave={vi.fn()}
      onApprove={vi.fn()}
      onUnapprove={vi.fn()}
      onSkip={vi.fn()}
    />);

    expect(screen.getByLabelText("Event start date")).toHaveValue("2026-06-22");
    expect(screen.getByLabelText("Event end date")).toHaveValue("2026-06-23");
    expect(screen.getByLabelText("Confirm event year from paper/context")).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Create new location under Emmett Cherry Festival" }));
    expect(screen.getByLabelText("New location label")).toHaveValue("Emmett");
    expect(screen.getByLabelText("New location city")).toHaveValue("Emmett");
    expect(screen.getByLabelText("New location state")).toHaveValue("ID");
  });
});
