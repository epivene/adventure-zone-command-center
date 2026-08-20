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
