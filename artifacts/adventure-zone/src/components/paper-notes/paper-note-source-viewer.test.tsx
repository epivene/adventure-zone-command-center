import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PaperNoteSourceViewer } from "./paper-note-source-viewer";

describe("PaperNoteSourceViewer", () => {
  it("loads a private URL only when the user opens the source", async () => {
    const loadSource = vi.fn(async () => ({ url: "https://signed.example/paper", kind: "original" as const }));
    render(<PaperNoteSourceViewer label="Page 2" loadSource={loadSource} />);

    expect(loadSource).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "View paper" }));

    await waitFor(() => expect(loadSource).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("dialog", { name: "Page 2 source paper" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Original paper photo for Page 2" })).toHaveAttribute(
      "src",
      "https://signed.example/paper",
    );
  });

  it("offers exact source restoration and retries viewing afterward", async () => {
    const loadSource = vi.fn()
      .mockRejectedValueOnce(new Error("The original paper photo is missing and must be restored."))
      .mockResolvedValueOnce({ url: "https://signed.example/restored", kind: "original" as const });
    const restoreSource = vi.fn(async () => undefined);
    render(
      <PaperNoteSourceViewer
        label="Page 4"
        loadSource={loadSource}
        restoreSource={restoreSource}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "View paper" }));
    const input = await screen.findByLabelText("Restore original photo");
    const file = new File(["original"], "page.jpg", { type: "image/jpeg" });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(restoreSource).toHaveBeenCalledWith(file));
    await waitFor(() => expect(loadSource).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("img", { name: "Original paper photo for Page 4" })).toHaveAttribute(
      "src",
      "https://signed.example/restored",
    );
  });

  it("closes on Escape and returns focus to the opener", async () => {
    const loadSource = vi.fn(async () => ({ url: "https://signed.example/paper", kind: "original" as const }));
    render(<PaperNoteSourceViewer label="Page 1" loadSource={loadSource} />);
    const opener = screen.getByRole("button", { name: "View paper" });
    fireEvent.click(opener);
    await screen.findByRole("dialog", { name: "Page 1 source paper" });
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(document.activeElement).toBe(opener);
  });
});
