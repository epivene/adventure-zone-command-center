import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/features/paper-notes/paper-note-client", () => ({
  createPaperNoteBatch: vi.fn(),
  createPaperNotePage: vi.fn(),
  uploadPaperNotePageImage: vi.fn(),
}));
vi.mock("@/features/paper-notes/paper-note-upload-queue", () => ({
  uploadPaperNoteFiles: vi.fn(),
}));

import { PaperNoteUploadPanel } from "./paper-note-upload-panel";

describe("PaperNoteUploadPanel mobile sources", () => {
  it("keeps gallery selection separate from camera capture", () => {
    render(<PaperNoteUploadPanel onUploaded={vi.fn()} />);

    const gallery = screen.getByLabelText("Choose photos from gallery") as HTMLInputElement;
    const camera = screen.getByLabelText("Take a paper note photo") as HTMLInputElement;

    expect(gallery.type).toBe("file");
    expect(gallery.multiple).toBe(true);
    expect(gallery.getAttribute("capture")).toBeNull();
    expect(gallery.accept).toBe("image/jpeg,image/png,image/webp");

    expect(camera.type).toBe("file");
    expect(camera.multiple).toBe(false);
    expect(camera.getAttribute("capture")).toBe("environment");
    expect(camera.accept).toBe("image/jpeg,image/png,image/webp");
  });
});
