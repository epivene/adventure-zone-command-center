// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ManagerWorkerPage from "./ManagerWorkerPage";

const mocks = vi.hoisted(() => ({
  api: vi.fn(async (path: string, init?: RequestInit) => {
    if (path === "/manager/crew") {
      return {
        workers: [{
          id: "worker-1",
          name: "Jamie Worker",
          phone: null,
          locationText: "Fargo, ND",
          rehireStatus: "rehirable",
          workHistory: [{ id: "history-1", role: "Setup crew", rating: 4, note: "Good worker" }],
          managerNotes: [{ id: "note-1", note: "Bring back next year" }],
        }],
      };
    }
    if (path.includes("/work-history/") && init?.method === "PATCH") return { entry: { id: "history-1" } };
    if (path.includes("/work-history/") && init?.method === "DELETE") return {};
    return {};
  }),
}));

vi.mock("@/lib/manager-auth-context", () => ({
  useManagerAuth: () => ({
    manager: { legId: "leg-a", legName: "Leg A", managerName: "Manager" },
    managerApi: mocks.api,
  }),
}));

vi.mock("@/lib/manager-sync-queue", () => ({
  queueManagerMutation: vi.fn(async () => {}),
  flushManagerMutationQueue: vi.fn(async () => {}),
}));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("ManagerWorkerPage", () => {
  it("shows saved manager notes", async () => {
    render(<ManagerWorkerPage workerId="worker-1" />);
    expect(await screen.findByText("Bring back next year")).toBeInTheDocument();
  });

  it("edits and deletes work history", async () => {
    render(<ManagerWorkerPage workerId="worker-1" />);
    await screen.findByText("Setup crew");
    fireEvent.click(screen.getByRole("button", { name: "Edit history" }));
    fireEvent.change(screen.getByLabelText("Edit role"), { target: { value: "Lead setup" } });
    fireEvent.click(screen.getByRole("button", { name: "Save history changes" }));
    await waitFor(() => expect(mocks.api).toHaveBeenCalledWith(
      "/manager/crew/worker-1/work-history/history-1",
      expect.objectContaining({ method: "PATCH" }),
    ));

    fireEvent.click(screen.getByRole("button", { name: "Delete history" }));
    await waitFor(() => expect(mocks.api).toHaveBeenCalledWith(
      "/manager/crew/worker-1/work-history/history-1",
      expect.objectContaining({ method: "DELETE" }),
    ));
  });
});
