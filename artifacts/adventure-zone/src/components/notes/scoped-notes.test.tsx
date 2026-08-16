// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScopedNotes } from "./scoped-notes";

const note = {
  id: "11111111-1111-4111-8111-111111111111",
  body: "Shared booking advice",
  createdAt: "2026-08-15T12:00:00.000Z",
  updatedAt: "2026-08-15T12:00:00.000Z",
};

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("ScopedNotes", () => {
  it("renders family context read-only", () => {
    render(<ScopedNotes title="Family notes" notes={[note]} readOnly />);
    expect(screen.getByText("Shared booking advice")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Add note" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  it("updates when async-loaded notes arrive after mount", () => {
    const { rerender } = render(<ScopedNotes title="Location notes" notes={[]} readOnly />);
    expect(screen.getByText("No notes yet.")).toBeVisible();
    rerender(<ScopedNotes title="Location notes" notes={[note]} readOnly />);
    expect(screen.getByText("Shared booking advice")).toBeVisible();
  });

  it("creates a note only after the mutation succeeds", async () => {
    const onCreate = vi.fn().mockResolvedValue({ ...note, id: "22222222-2222-4222-8222-222222222222", body: "New note" });
    render(<ScopedNotes title="Location notes" notes={[]} onCreate={onCreate} />);
    fireEvent.click(screen.getByRole("button", { name: "Add note" }));
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "New note" } });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith("New note"));
    expect(await screen.findByText("New note")).toBeVisible();
  });

  it("keeps a note visible when deletion fails", async () => {
    const onDelete = vi.fn().mockRejectedValue(new Error("Could not delete note"));
    render(<ScopedNotes title="Family notes" notes={[note]} onDelete={onDelete} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not delete note");
    expect(screen.getByText("Shared booking advice")).toBeVisible();
  });

  it("shows updated metadata when the timestamps differ", () => {
    render(<ScopedNotes title="Family notes" notes={[{ ...note, updatedAt: "2026-08-15T13:00:00.000Z" }]} readOnly />);
    expect(screen.getByText(/Updated/)).toBeVisible();
  });
});
