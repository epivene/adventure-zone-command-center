import { afterEach, describe, expect, it, vi } from "vitest";
import { ReadableStream } from "node:stream/web";
import { apiFetch } from "@/lib/auth-token";
import { downloadAccountantPackage, MAX_BUFFERED_PACKAGE_BYTES } from "./package-download";

vi.mock("@/lib/auth-token", () => ({ apiFetch: vi.fn() }));
const fetchMock = vi.mocked(apiFetch);
const writer = () => ({ write: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined), abort: vi.fn().mockResolvedValue(undefined) });
function response(chunks: Uint8Array[]) {
  return { ok: true, body: new ReadableStream<Uint8Array>({ start(controller) {
    for (const chunk of chunks) controller.enqueue(chunk);
    controller.close();
  } }) } as unknown as Response;
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); fetchMock.mockReset(); delete (window as unknown as Record<string, unknown>).showSaveFilePicker; });

describe("private accountant package client", () => {
  it("streams authenticated response chunks to disk instead of buffering the whole package", async () => {
    const file = writer();
    const picker = vi.fn().mockResolvedValue({ createWritable: async () => file });
    Object.assign(window, { showSaveFilePicker: picker });
    fetchMock.mockResolvedValue(response([new Uint8Array([1]), new Uint8Array([2])]));
    expect(await downloadAccountantPackage(2025)).toBe("saved");
    expect(picker).toHaveBeenCalledWith(expect.objectContaining({ suggestedName: "booking-agent-accountant-2025.zip" }));
    expect(fetchMock).toHaveBeenCalledWith("/admin/agent-tax/package?year=2025", { cache: "no-store" });
    expect(file.write).toHaveBeenCalledTimes(2); expect(file.close).toHaveBeenCalledOnce(); expect(file.abort).not.toHaveBeenCalled();
  });
  it("cancels cleanly before requesting private records if the save dialog is dismissed", async () => {
    Object.assign(window, { showSaveFilePicker: vi.fn().mockRejectedValue(new DOMException("cancel", "AbortError")) });
    expect(await downloadAccountantPackage(2026)).toBe("cancelled");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("aborts the disk write and surfaces the server error on denied authentication", async () => {
    const file = writer();
    Object.assign(window, { showSaveFilePicker: vi.fn().mockResolvedValue({ createWritable: async () => file }) });
    fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: "Owner authentication required" }) } as Response);
    await expect(downloadAccountantPackage(2026)).rejects.toThrow("Owner authentication required");
    expect(file.abort).toHaveBeenCalledOnce(); expect(file.close).not.toHaveBeenCalled();
  });
  it("never saves an incomplete package when the streamed response fails", async () => {
    const file = writer();
    Object.assign(window, { showSaveFilePicker: vi.fn().mockResolvedValue({ createWritable: async () => file }) });
    fetchMock.mockResolvedValue({ ok: true, body: new ReadableStream({ start(controller) { controller.error(new Error("interrupted")); } }) } as unknown as Response);
    await expect(downloadAccountantPackage(2026)).rejects.toThrow("interrupted");
    expect(file.abort).toHaveBeenCalledOnce(); expect(file.close).not.toHaveBeenCalled();
  });
  it("bounds fallback memory when save-to-disk is unavailable", async () => {
    fetchMock.mockResolvedValue(response([new Uint8Array(MAX_BUFFERED_PACKAGE_BYTES + 1)]));
    await expect(downloadAccountantPackage(2026)).rejects.toThrow("64 MB");
  });
  it("downloads a small ZIP through a temporary local blob URL, not a remote credential-bearing link", async () => {
    const createObjectURL = vi.fn().mockReturnValue("blob:local-package");
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    fetchMock.mockResolvedValue(response([new Uint8Array([1, 2, 3])]));
    expect(await downloadAccountantPackage(2026)).toBe("started");
    expect(click).toHaveBeenCalledOnce(); expect(createObjectURL).toHaveBeenCalledOnce();
  });
});
