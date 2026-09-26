import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Conversation } from "@/features/assistant-workspace/types";
const state = vi.hoisted(() => ({
  reject: false,
  prepared: false,
  ready: true,
}));
vi.mock("@/features/assistant-workspace/offline-prepare", () => ({
  prepareOfflineWorkspace: async () => {
    if (state.reject) throw new Error("Storage full");
    state.prepared = true;
    return { preparedAt: Date.now(), expiresAt: Date.now() + 86400000 };
  },
}));
vi.mock("@/features/assistant-workspace/offline-store", () => ({
  loadOfflineWorkspace: async () => ({
    snapshots: state.prepared
      ? [
          {
            conversation: { id: "c1" },
            preparedAt: Date.now(),
            expiresAt: Date.now() + 86400000,
          },
        ]
      : [],
  }),
}));
vi.mock("@/lib/offline/workspace-shell", () => ({
  isOfflineShellReady: async () => state.ready,
}));
import { OfflinePreparation } from "./OfflinePreparation";
const conversation = { id: "c1" } as Conversation;
beforeEach(() => {
  state.reject = false;
  state.prepared = false;
  state.ready = true;
});
it("offers deliberate preparation and reports ready only after success", async () => {
  render(<OfflinePreparation conversation={conversation} />);
  fireEvent.click(screen.getByRole("button", { name: /prepare for offline/i }));
  expect(await screen.findByText(/ready on this device/i)).toBeInTheDocument();
});
it("keeps a failed save visibly unready", async () => {
  state.reject = true;
  render(<OfflinePreparation conversation={conversation} />);
  fireEvent.click(screen.getByRole("button", { name: /prepare for offline/i }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Storage full");
  expect(screen.queryByText(/ready on this device/i)).not.toBeInTheDocument();
});
it("does not label saved records ready when the app cache was removed", async () => {
  state.prepared = true;
  state.ready = false;
  render(<OfflinePreparation conversation={conversation} />);
  await waitFor(() =>
    expect(screen.getByText(/app files.*prepare again/i)).toBeInTheDocument(),
  );
  expect(screen.queryByText(/ready on this device/i)).not.toBeInTheDocument();
});
