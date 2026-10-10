// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { latestProfileNote } from "./latest-profile-note";
import { ProfileLatestNote } from "./profile-latest-note";

const create = vi.hoisted(() => vi.fn());
vi.mock("@/actions/activities", () => ({ createActivityAction: create }));
const note = (id: string, occurredAt: string, body = id, kind = "note") => ({
  id, occurredAt, createdAt: occurredAt, kind, body,
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("front-and-center profile note", () => {
  it("selects the newest actual note rather than the newest call or audit record", () => {
    expect(latestProfileNote([
      note("older", "2026-01-01"), note("newest-note", "2026-08-01"),
      note("call", "2026-09-01", "Called organizer", "call"),
      note("audit", "2026-10-01", "Record updated", "audit"),
    ])?.id).toBe("newest-note");
  });
  it("does not mistake an imported unknown-date note for a recent note", () => {
    expect(latestProfileNote([
      { ...note("import", "2026-10-01"), historicalDateUnknown: true },
      note("dated", "2026-01-01"),
    ])?.id).toBe("dated");
  });
  it("keeps the related email link inside the front-and-center latest-note card", () => {
    render(<ProfileLatestNote profileId="profile-1" notes={[note("latest", "2026-08-01", "Recent organizer update")]}
      relatedActivity={<a href="/emails?profileId=profile-1&threadId=thread-1">Open latest email</a>} />);
    const card = screen.getByTestId("profile-latest-note");
    expect(card).toHaveTextContent("Recent organizer update");
    expect(card).toContainElement(screen.getByRole("link", { name: "Open latest email" }));
  });
  it("shows a saved note immediately and refreshes the existing profile", async () => {
    create.mockResolvedValue({ ok: true, activity: note("saved", "2026-10-08", "Newest saved note") });
    const refresh = vi.fn();
    render(<ProfileLatestNote profileId="profile-1" contactId="contact-1" notes={[note("old", "2026-01-01")]} onSaved={refresh} />);
    fireEvent.click(screen.getByRole("button", { name: "Add note" }));
    fireEvent.change(screen.getByLabelText("New note"), { target: { value: "Newest saved note" } });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    await waitFor(() => expect(screen.getByTestId("profile-latest-note-body")).toHaveTextContent("Newest saved note"));
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "profile-1", contactId: "contact-1", kind: "note", body: "Newest saved note" }));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent("Note saved");
  });
  it("retains the draft when saving fails", async () => {
    create.mockResolvedValue({ ok: false, error: "Could not save note" });
    render(<ProfileLatestNote profileId="profile-1" notes={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Add note" }));
    fireEvent.change(screen.getByLabelText("New note"), { target: { value: "Keep this draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Could not save note"));
    expect(screen.getByLabelText("New note")).toHaveValue("Keep this draft");
  });
});
