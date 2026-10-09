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
    await screen.findByText("No partial changes were committed.");
    expect(screen.getByDisplayValue("Example festival")).toBeTruthy();
  });
  it("refreshes the list and provides a real saved-profile link on success", async () => {
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ draft, candidates: [], warnings: [] }), { status: 200 }));
    mocks.post.mockResolvedValue({ organizationId: candidate.id, created: true, filledFields: ["name"], preservedFields: [] });
    const refresh = vi.fn();
    render(<FestivalNetImportDialog open onOpenChange={vi.fn()} onImported={refresh} />);
    fireEvent.change(screen.getByLabelText(/PDF file/i), { target: { files: [new File(["%PDF"], "example.pdf", { type: "application/pdf" })] } });
    await screen.findByDisplayValue("Example festival");
    fireEvent.click(screen.getByTestId("button-festivalnet-apply"));
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(screen.getByRole("link").getAttribute("href")).toBe(`/profiles/${candidate.id}`);
  });
});
