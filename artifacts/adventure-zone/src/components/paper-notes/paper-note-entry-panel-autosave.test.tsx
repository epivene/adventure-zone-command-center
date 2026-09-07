import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

let capturedProps: any = null;
vi.mock("./paper-note-entry-card", () => ({
  PaperNoteEntryCard: (props: any) => {
    capturedProps = props;
    return <div data-testid="paper-note-entry-card" />;
  },
}));

const baseEntry = {
  id: "entry-1",
  reviewVersion: 2,
  state: "needs_review",
  approvedAt: null,
  validationIssues: [],
  extraction: { transcription: "County Fair note" },
  review: {
    event: { name: "County Fair", city: "", region: "", venue: "", eventDateText: "", startsOn: null, endsOn: null, pageYearConfirmed: false },
    activity: { occurredOn: null, method: "call", outcome: "", summary: "" },
    contacts: [], organizationPhones: [], oldReminder: "", starredOnPaper: false, generalNotes: [], destination: null, conflicts: {}, currentFollowUp: { enabled: false, kind: "call", dueOn: null, contactKey: null },
  },
};

let resolveFirst!: (value: any) => void;
const firstSave = new Promise((resolve) => { resolveFirst = resolve; });
const savePaperNoteEntryReview = vi.fn()
  .mockImplementationOnce(() => firstSave)
  .mockImplementationOnce(async (_entryId: string, review: any, expectedVersion: number) => ({
    ...baseEntry,
    review,
    reviewVersion: expectedVersion + 1,
  }));

vi.mock("@/features/paper-notes/paper-note-client", () => ({
  getPaperNoteEntryReview: vi.fn(async () => baseEntry),
  getPaperNoteEntryMatches: vi.fn(async () => []),
  getPaperNoteEntrySource: vi.fn(),
  savePaperNoteEntryReview: (...args: any[]) => savePaperNoteEntryReview(...args),
  approvePaperNoteEntry: vi.fn(),
  unapprovePaperNoteEntry: vi.fn(),
  skipPaperNoteEntry: vi.fn(),
}));

import { PaperNoteEntryPanel } from "./paper-note-entry-panel";

describe("PaperNoteEntryPanel autosave serialization", () => {
  it("queues a second review save until the first version finishes without refreshing the whole batch", async () => {
    capturedProps = null;
    savePaperNoteEntryReview.mockClear();
    const onChanged = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <PaperNoteEntryPanel entryId="entry-1" onChanged={onChanged} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(capturedProps).not.toBeNull());

    const reviewA = {
      ...baseEntry.review,
      event: { ...baseEntry.review.event, name: "County Fair 2026" },
    };
    const reviewB = {
      ...reviewA,
      event: { ...reviewA.event, city: "Fictional City" },
    };

    const first = capturedProps.onSave(reviewA, 2);
    const second = capturedProps.onSave(reviewB, 2);
    await waitFor(() => expect(savePaperNoteEntryReview).toHaveBeenCalledTimes(1));
    expect(savePaperNoteEntryReview.mock.calls[0]?.[2]).toBe(2);

    await act(async () => {
      resolveFirst({ ...baseEntry, review: reviewA, reviewVersion: 3 });
      await first;
      await second;
    });

    expect(savePaperNoteEntryReview).toHaveBeenCalledTimes(2);
    expect(savePaperNoteEntryReview.mock.calls[1]?.[1].event.city).toBe("Fictional City");
    expect(savePaperNoteEntryReview.mock.calls[1]?.[2]).toBe(3);
    expect(onChanged).not.toHaveBeenCalled();
  });
});
