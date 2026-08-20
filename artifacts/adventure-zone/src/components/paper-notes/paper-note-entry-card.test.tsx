import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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

afterEach(() => {
  vi.useRealTimers();
});

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
    expect(screen.getByLabelText("Phone type")).toHaveValue("office");
    expect(screen.getByLabelText("Phone label")).toHaveValue("fair office");
    expect(screen.getByLabelText("Phone status")).toHaveValue("active");
    expect(screen.getByLabelText("Import as structured phone")).toBeChecked();
    expect(screen.getByLabelText("Old reminder from paper")).toHaveValue("Call Monday");
    expect(screen.getByLabelText("Starred on original paper")).toBeChecked();
    expect(screen.getByText("Organization / main office phones")).toBeInTheDocument();
    expect(screen.getByDisplayValue("208-555-0100")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create new profile" })).toBeInTheDocument();
  });

  it("explains why an existing profile was suggested and lets the contact link to a saved person", () => {
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
    expect(screen.getByLabelText("Contact handling")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Contact handling"), { target: { value: "existing_contact" } });
    expect(screen.getByLabelText("Existing contact")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Tina Smith/ })).toBeInTheDocument();
  });

  it("queues edits made while a save is in flight instead of overlapping review versions", async () => {
    vi.useFakeTimers();
    let resolveFirst!: (value: any) => void;
    const firstSave = new Promise((resolve) => { resolveFirst = resolve; });
    const onSave = vi.fn()
      .mockImplementationOnce(() => firstSave)
      .mockImplementationOnce(async (review: any) => ({
        ...entry,
        review,
        reviewVersion: 4,
      }));

    render(<PaperNoteEntryCard
      entry={entry as any}
      matches={[]}
      loadSource={vi.fn()}
      onSave={onSave}
      onApprove={vi.fn()}
      onUnapprove={vi.fn()}
      onSkip={vi.fn()}
    />);

    fireEvent.change(screen.getByLabelText("Event / profile name"), {
      target: { value: "Emmett Cherry Festival 2026" },
    });
    await act(async () => { vi.advanceTimersByTime(700); });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0]?.[1]).toBe(2);

    fireEvent.change(screen.getByLabelText("City"), { target: { value: "Emmett City" } });
    await act(async () => { vi.advanceTimersByTime(700); });
    expect(onSave).toHaveBeenCalledTimes(1);

    const firstReview = onSave.mock.calls[0]?.[0];
    await act(async () => {
      resolveFirst({ ...entry, review: firstReview, reviewVersion: 3 });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave.mock.calls[1]?.[0].event.city).toBe("Emmett City");
    expect(onSave.mock.calls[1]?.[1]).toBe(3);
  });
});
