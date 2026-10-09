// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FestivalNetImportDialog } from "./festivalnet-import-dialog";
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), post: vi.fn() }));
vi.mock("@/lib/auth-token", () => ({ apiFetch: mocks.fetch, apiPost: mocks.post }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const draft = { name: "Example festival", year: 2026, sourceUrl: "https://festivalnet.com/999999001/Example", sourceFilename: "example.pdf", phone: "incoming phone", details: { attendance: "1,500" } };
const candidate = { id: "11111111-1111-4111-8111-111111111111", name: "Example festival", existingFields: { phone: "saved phone" }, details: { attendance: "9,000" } };
async function upload(candidates: unknown[] = []) {
  mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ draft, candidates, warnings: ["Review this PDF."] }), { status: 200 }));
  render(<FestivalNetImportDialog open onOpenChange={vi.fn()} />);
  const file = screen.getByLabelText(/PDF file/i);
  fireEvent.change(file, { target: { files: [new File(["%PDF-test"], "example.pdf", { type: "application/pdf" })] } });
  await screen.findByDisplayValue("Example festival");
}
describe("FestivalNet import review", () => {
  it("does not save on upload and requires selecting a possible existing match", async () => {
    await upload([candidate]);
    expect(mocks.post).not.toHaveBeenCalled();
    const button = screen.getByTestId("button-festivalnet-apply") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(screen.getByRole("radio"));
    expect(button.disabled).toBe(false);
    expect(screen.getByText("Saved: saved phone")).toBeTruthy();
    expect(screen.getByText("Saved: 9,000")).toBeTruthy();
  });
  it("retains the editable draft after a save failure", async () => {
    await upload();
    mocks.post.mockRejectedValue(new Error("No partial changes were committed."));
    fireEvent.click(screen.getByTestId("button-festivalnet-apply"));
    await screen.findByText(/No partial changes were committed\./);
    expect(screen.getByDisplayValue("Example festival")).toBeTruthy();
  });
  it("refreshes the list and provides a real saved-profile link on success", async () => {
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ draft, candidates: [], warnings: [] }), { status: 200 }));
    mocks.post.mockResolvedValue({ outcomes: [{ entryId: "pdf-1", result: { organizationId: candidate.id, created: true, filledFields: ["name"], preservedFields: [] }, error: null }] });
    const refresh = vi.fn();
    render(<FestivalNetImportDialog open onOpenChange={vi.fn()} onImported={refresh} />);
    fireEvent.change(screen.getByLabelText(/PDF file/i), { target: { files: [new File(["%PDF"], "example.pdf", { type: "application/pdf" })] } });
    await screen.findByDisplayValue("Example festival");
    fireEvent.click(screen.getByTestId("button-festivalnet-apply"));
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(screen.getByRole("link").getAttribute("href")).toBe(`/profiles/${candidate.id}`);
  });
  it("reviews multiple PDFs, excludes a parse failure and retries only unsaved rows", async () => {
    mocks.fetch.mockImplementation(async (url: string) => {
      if (url.includes("broken.pdf")) return new Response(JSON.stringify({ error: "This PDF is scanned." }), { status: 400 });
      return new Response(JSON.stringify({ draft: { ...draft, sourceFilename: url.includes("second.pdf") ? "second.pdf" : "example.pdf" }, candidates: [], warnings: [] }));
    });
    const refresh = vi.fn();
    render(<FestivalNetImportDialog open onOpenChange={vi.fn()} onImported={refresh} />);
    fireEvent.change(screen.getByLabelText(/PDF files/i), { target: { files: ["example.pdf", "second.pdf", "broken.pdf"].map(name => new File(["%PDF"], name, { type: "application/pdf" })) } });
    await screen.findByText("This PDF is scanned.");
    expect(screen.getAllByTestId(/festivalnet-row/)).toHaveLength(3);
    expect(mocks.post).not.toHaveBeenCalled();
    expect((screen.getByTestId("button-festivalnet-apply") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getAllByRole("button", { name: "Exclude" })[2]);
    mocks.post.mockResolvedValueOnce({ outcomes: [
      { entryId: "pdf-1", result: { organizationId: candidate.id, created: true, filledFields: ["name"], preservedFields: [] }, error: null },
      { entryId: "pdf-2", result: null, error: "No partial changes were committed." },
    ] });
    fireEvent.click(screen.getByTestId("button-festivalnet-apply"));
    await screen.findByText("No partial changes were committed.");
    expect(screen.getByRole("status").textContent).toBe("1 saved · 1 remaining · 1 excluded");
    expect(refresh).toHaveBeenCalledOnce();
    mocks.post.mockResolvedValueOnce({ outcomes: [
      { entryId: "pdf-2", result: { organizationId: candidate.id, created: false, filledFields: [], preservedFields: [] }, error: null },
    ] });
    fireEvent.click(screen.getByRole("button", { name: "Confirm retry of this file" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("2 saved · 0 remaining · 1 excluded"));
    expect(mocks.post.mock.calls[1][1].entries.map((entry: { entryId: string }) => entry.entryId)).toEqual(["pdf-2"]);
  });
  it("retries unreadable files and retains edits when checking an edited year", async () => {
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: "This PDF could not be read." }), { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ draft, candidates: [], warnings: [] })));
    render(<FestivalNetImportDialog open onOpenChange={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/PDF files/i), { target: { files: [new File(["%PDF"], "example.pdf", { type: "application/pdf" })] } });
    await screen.findByText("This PDF could not be read.");
    fireEvent.click(screen.getByRole("button", { name: "Retry PDF" }));
    await screen.findByDisplayValue("Example festival");
    fireEvent.change(screen.getByLabelText("Year"), { target: { value: "2027" } });
    fireEvent.change(screen.getByLabelText(/^Phone/), { target: { value: "reviewed phone" } });
    mocks.post.mockResolvedValueOnce({ candidates: [candidate] });
    fireEvent.click(screen.getByRole("button", { name: "Recheck matches" }));
    await screen.findByRole("radio");
    expect(screen.getByDisplayValue("2027")).toBeTruthy();
    expect(screen.getByDisplayValue("reviewed phone")).toBeTruthy();
    expect(mocks.post).toHaveBeenCalledWith("/festivalnet-import/matches", expect.objectContaining({ year: 2027, phone: "reviewed phone" }));
  });
});
