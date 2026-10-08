import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FestivalEditionEditor } from "./festival-edition-editor";

const state = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@/lib/auth-token", () => ({ apiFetch: state.fetch }));
const edition = {
  id: "10000000-0000-4000-8000-000000000001",
  organizationId: "10000000-0000-4000-8000-000000000002",
  year: 2029,
  details: { startsOn: "2029-08-21", venue: "Existing venue", futureField: "Preserve this" },
  updatedAt: "2026-10-08T21:00:00.000Z",
};
beforeEach(() => state.fetch.mockReset());
describe("festival year editor", () => {
  it("saves explicit JSON, keeps unknown saved fields and uses the captured version", async () => {
    state.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => edition });
    const saved = vi.fn();
    render(<FestivalEditionEditor organizationId={edition.organizationId} edition={edition} initialYear={2029} onSaved={saved} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Venue and event address"), { target: { value: "Updated venue" } });
    fireEvent.submit(screen.getByRole("form", { name: "Festival year editor" }));
    await waitFor(() => expect(saved).toHaveBeenCalledWith(edition));
    const [, options] = state.fetch.mock.calls[0]!;
    expect(options.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(options.body)).toEqual({ details: { ...edition.details, venue: "Updated venue" }, expectedUpdatedAt: edition.updatedAt });
    expect(screen.getByLabelText("Event year")).toBeDisabled();
  });
  it("retains the draft after a stale-version rejection until the user discards it", async () => {
    state.fetch.mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: "Changed in another session." }) });
    const saved = vi.fn(), cancel = vi.fn();
    render(<FestivalEditionEditor organizationId={edition.organizationId} edition={edition} initialYear={2029} onSaved={saved} onCancel={cancel} />);
    fireEvent.change(screen.getByLabelText("Venue and event address"), { target: { value: "Unsaved draft" } });
    fireEvent.submit(screen.getByRole("form", { name: "Festival year editor" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Changed in another session.");
    expect(screen.getByLabelText("Venue and event address")).toHaveValue("Unsaved draft");
    expect(saved).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Reload saved details (discard draft)" }));
    expect(cancel).toHaveBeenCalledOnce();
  });
});
