import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/features/paper-notes/paper-note-client", () => ({
  getPaperNoteEntryReview: vi.fn(async () => ({
    id: "entry-1",
    reviewVersion: 0,
    state: "needs_review",
    approvedAt: null,
    validationIssues: [],
    extraction: { transcription: "County Fair note" },
    review: {
      event: { name: "County Fair", city: "", region: "", venue: "", eventDateText: "", startsOn: null, endsOn: null, pageYearConfirmed: false },
      activity: { occurredOn: null, method: "call", outcome: "", summary: "" },
      contacts: [], organizationPhones: [], oldReminder: "", starredOnPaper: false, generalNotes: [], destination: null, conflicts: {}, currentFollowUp: { enabled: false, kind: "call", dueOn: null, contactKey: null },
    },
  })),
  getPaperNoteEntryMatches: vi.fn(async () => []),
  getPaperNoteEntrySource: vi.fn(),
  savePaperNoteEntryReview: vi.fn(),
  approvePaperNoteEntry: vi.fn(),
  unapprovePaperNoteEntry: vi.fn(),
  skipPaperNoteEntry: vi.fn(),
}));

import { PaperNoteEntryPanel } from "./paper-note-entry-panel";

describe("PaperNoteEntryPanel", () => {
  it("loads one selected entry instead of rendering the whole batch at once", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <PaperNoteEntryPanel entryId="entry-1" onChanged={vi.fn()} />
      </QueryClientProvider>,
    );
    expect(await screen.findByDisplayValue("County Fair")).toBeInTheDocument();
    expect(screen.getByText("County Fair note")).toBeInTheDocument();
  });
});
