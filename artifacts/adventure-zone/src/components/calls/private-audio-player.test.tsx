import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth-token", () => ({ apiFetch }));

import { PrivateAudioPlayer } from "./private-audio-player";

afterEach(() => {
  cleanup();
  apiFetch.mockReset();
  vi.unstubAllGlobals();
});

describe("PrivateAudioPlayer", () => {
  it("clears a previous load error when a retry succeeds", async () => {
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn().mockReturnValue("blob:voicemail"),
      revokeObjectURL: vi.fn(),
    });
    apiFetch
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true, blob: async () => new Blob(["audio"]) });
    render(<PrivateAudioPlayer available voicemailId="voicemail-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Load private audio" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Audio could not be loaded");

    fireEvent.click(screen.getByRole("button", { name: "Load private audio" }));
    await screen.findByLabelText("Voicemail audio");
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });
});
