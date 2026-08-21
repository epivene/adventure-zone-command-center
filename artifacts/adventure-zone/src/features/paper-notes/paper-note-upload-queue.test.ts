import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./paper-note-client", () => ({
  createPaperNotePage: vi.fn(),
  uploadPaperNotePageImage: vi.fn(),
}));

import { createPaperNotePage, uploadPaperNotePageImage } from "./paper-note-client";
import { uploadPaperNoteFiles } from "./paper-note-upload-queue";

const createPage = vi.mocked(createPaperNotePage);
const uploadImage = vi.mocked(uploadPaperNotePageImage);

function file(name: string, type = "image/png") {
  return new File([new Uint8Array([1, 2, 3])], name, { type });
}

describe("uploadPaperNoteFiles", () => {
  beforeEach(() => {
    createPage.mockReset();
    uploadImage.mockReset();
  });

  it("uploads pages sequentially, carrying the selected paper year", async () => {
    const calls: string[] = [];
    createPage.mockImplementation(async ({ filename, paperYear }) => {
      calls.push(`create:${filename}:${paperYear}`);
      return { pageId: filename === "one.png" ? "10000000-0000-4000-8000-000000000001" : "20000000-0000-4000-8000-000000000001" };
    });
    uploadImage.mockImplementation(async ({ file: current }) => {
      calls.push(`upload:${current.name}`);
      return { ok: true };
    });
    const progress: string[] = [];

    const result = await uploadPaperNoteFiles({
      batchId: "30000000-0000-4000-8000-000000000001",
      paperYear: 2026,
      files: [file("one.png"), file("two.png")],
      onProgress(update) { progress.push(`${update.filename}:${update.state}`); },
    });

    expect(calls).toEqual([
      "create:one.png:2026",
      "upload:one.png",
      "create:two.png:2026",
      "upload:two.png",
    ]);
    expect(result.every((item) => item.ok)).toBe(true);
    expect(progress).toContain("one.png:uploaded");
    expect(progress).toContain("two.png:uploaded");
  });

  it("rejects unsupported files without any API calls", async () => {
    const result = await uploadPaperNoteFiles({
      batchId: "30000000-0000-4000-8000-000000000001",
      paperYear: 2026,
      files: [file("notes.pdf", "application/pdf")],
      onProgress() {},
    });
    expect(result[0]).toMatchObject({ ok: false, pageId: null });
    expect(createPage).not.toHaveBeenCalled();
    expect(uploadImage).not.toHaveBeenCalled();
  });

  it("bounds each upload batch to 25 files", async () => {
    const files = Array.from({ length: 26 }, (_, index) => file(`${index}.png`));
    await expect(uploadPaperNoteFiles({
      batchId: "30000000-0000-4000-8000-000000000001",
      paperYear: 2026,
      files,
      onProgress() {},
    })).rejects.toThrow("25");
  });
});
