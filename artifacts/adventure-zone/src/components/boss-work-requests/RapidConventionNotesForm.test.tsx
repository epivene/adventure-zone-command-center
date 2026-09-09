import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RapidConventionNotesForm } from "./RapidConventionNotesForm";
import { submitConventionNotes, updateConventionNotes } from "@/features/boss-work-requests/boss-work-request-api";

vi.mock("@/features/boss-work-requests/boss-work-request-api", () => ({
  saveConventionDraft: vi.fn(async (_id, clientRevision) => ({ accepted: true, draft: { clientRevision } })),
  submitConventionNotes: vi.fn(async () => ({ created: true, submission: { id: "saved" } })),
  updateConventionNotes: vi.fn(),
}));

const detail = {
  request: {
    id: "11111111-1111-4111-8111-111111111111",
    type: "rapid_convention_notes" as const,
    state: "in_progress" as const,
    priority: "normal" as const,
    title: "Rapid Convention Notes",
    instructions: null, dueAt: null, completedAt: null,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  },
  draft: null,
  submissions: [],
  templateReview: null,
};

describe("RapidConventionNotesForm", () => {
  beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); });

  it("clears the visible form only after the server confirms Save & Start Next", async () => {
    let finish: ((value: any) => void) | undefined;
    vi.mocked(submitConventionNotes).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const reload = vi.fn(async () => undefined);
    render(<RapidConventionNotesForm detail={detail} reload={reload} />);

    const eventName = screen.getByLabelText("Event name *") as HTMLInputElement;
    fireEvent.change(eventName, { target: { value: "County Fair" } });
    fireEvent.click(screen.getByRole("button", { name: "Save & Start Next" }));
    expect(eventName.value).toBe("County Fair");

    finish?.({ created: true, submission: { id: "saved" } });
    await waitFor(() => expect(eventName.value).toBe(""));
    expect(reload).toHaveBeenCalledOnce();
  });

  it("reopens unapplied Saved Today entries for editing", () => {
    render(<RapidConventionNotesForm detail={{
      ...detail,
      submissions: [{
        id: "22222222-2222-4222-8222-222222222222",
        requestId: detail.request.id,
        clientMutationId: "33333333-3333-4333-8333-333333333333",
        payload: { eventName: "Tomato Days", contactName: "Jamie" },
        editVersion: 1, appliedAt: null,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      }],
    }} reload={vi.fn(async () => undefined)} />);
    fireEvent.click(screen.getByRole("button", { name: /Tomato Days/ }));
    expect((screen.getByLabelText("Event name *") as HTMLInputElement).value).toBe("Tomato Days");
    expect(screen.getByRole("button", { name: "Update Saved Notes" })).toBeTruthy();
    expect(updateConventionNotes).not.toHaveBeenCalled();
  });
});
