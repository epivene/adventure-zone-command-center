// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
const apiPost = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth-token", () => ({ apiPost }));
import BusinessDocumentImportPage from "./BusinessDocumentImportPage";

describe("BusinessDocumentImportPage", () => {
  it("previews approved roots before offering an explicit pilot", async () => {
    apiPost.mockResolvedValueOnce({ runId: "preview-1", discovered: 7, imported: 0, deduplicated: 0, linked: 0, review: 0, skipped: 0, retry: 0, failed: 0 });
    render(<BusinessDocumentImportPage />);
    expect(screen.queryByRole("button", { name: "Start 25-file pilot" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Approved Drive folder IDs"), { target: { value: "contracts-folder" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview approved folders" }));
    expect(await screen.findByText("Preview results")).toBeVisible();
    expect(screen.getByRole("button", { name: "Start 25-file pilot" })).toBeVisible();
    expect(apiPost).toHaveBeenCalledWith("/business-document-imports/drive/preview", { folderIds: ["contracts-folder"] });
  });

  it("requires the preview run when starting a pilot", async () => {
    apiPost.mockReset()
      .mockResolvedValueOnce({ runId: "preview-1", discovered: 1 })
      .mockResolvedValueOnce({ runId: "pilot-1", discovered: 1, imported: 1 });
    render(<BusinessDocumentImportPage />);
    fireEvent.change(screen.getByLabelText("Approved Drive folder IDs"), { target: { value: "contracts-folder" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview approved folders" }));
    fireEvent.click(await screen.findByRole("button", { name: "Start 25-file pilot" }));
    await waitFor(() => expect(apiPost).toHaveBeenLastCalledWith("/business-document-imports/drive/start", { previewRunId: "preview-1", confirmation: "START PILOT", pilotLimit: 25 }));
    expect(await screen.findByText("Drive pilot is running in the background.")).toBeVisible();
    expect(screen.queryByText("Pilot results")).not.toBeInTheDocument();
  });

  it("previews a bounded Gmail date window before offering its pilot", async () => {
    apiPost.mockReset().mockResolvedValueOnce({ runId: "gmail-preview", discovered: 4 });
    render(<BusinessDocumentImportPage />);
    fireEvent.change(screen.getByLabelText("Gmail start date"), { target: { value: "2025-01-01" } });
    fireEvent.change(screen.getByLabelText("Gmail end date"), { target: { value: "2026-01-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview Gmail attachments" }));
    expect(await screen.findByText("4 attachments discovered")).toBeVisible();
    expect(screen.getByRole("button", { name: "Start Gmail pilot" })).toBeVisible();
    expect(apiPost).toHaveBeenCalledWith("/business-document-imports/gmail/preview", { after: "2025-01-01", before: "2026-01-01" });
  });

  it("shows that an accepted Gmail pilot continues in the background", async () => {
    apiPost.mockReset()
      .mockResolvedValueOnce({ runId: "gmail-preview", discovered: 4 })
      .mockResolvedValueOnce({ accepted: true, previewRunId: "gmail-preview" });
    render(<BusinessDocumentImportPage />);
    fireEvent.change(screen.getByLabelText("Gmail start date"), { target: { value: "2025-01-01" } });
    fireEvent.change(screen.getByLabelText("Gmail end date"), { target: { value: "2026-01-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview Gmail attachments" }));
    fireEvent.click(await screen.findByRole("button", { name: "Start Gmail pilot" }));
    await waitFor(() => expect(apiPost).toHaveBeenLastCalledWith("/business-document-imports/gmail/start", { previewRunId: "gmail-preview", confirmation: "START PILOT", pilotLimit: 25 }));
    expect(await screen.findByText("Gmail pilot is running in the background.")).toBeVisible();
  });
});
