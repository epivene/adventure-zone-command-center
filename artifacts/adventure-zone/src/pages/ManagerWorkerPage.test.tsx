// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ManagerWorkerPage from "./ManagerWorkerPage";

const mocks = vi.hoisted(() => ({
  historyRole: "Setup crew",
  noteText: "Bring back next year",
  historyDeleted: false,
  noteDeleted: false,
  workerDeleted: false,
  api: vi.fn(async (path: string, init?: RequestInit) => {
    if (path === "/manager/crew") {
      return {
        workers: [{
          id: "worker-1",
          name: "Jamie Worker",
          phone: null,
          locationText: "Fargo, ND",
          rehireStatus: "rehirable",
          workHistory: mocks.historyDeleted ? [] : [{ id: "history-1", legId: "leg-a", role: mocks.historyRole, rating: 4, note: "Good worker" }],
          managerNotes: mocks.noteDeleted ? [] : [{ id: "note-1", legId: "leg-a", note: mocks.noteText }],
        }],
      };
    }
    if (path === "/manager/crew/worker-1" && init?.method === "DELETE") { mocks.workerDeleted = true; return { ok: true }; }
    if (path.includes("/work-history/") && init?.method === "PATCH") {
      const body = JSON.parse(String(init.body)); mocks.historyRole = body.role; return { entry: { id: "history-1", role: body.role } };
    }
    if (path.includes("/work-history/") && init?.method === "DELETE") { mocks.historyDeleted = true; return {}; }
    if (path.includes("/notes/") && init?.method === "PATCH") {
      const body = JSON.parse(String(init.body)); mocks.noteText = body.note; return { note: { id: "note-1", note: body.note } };
    }
    if (path.includes("/notes/") && init?.method === "DELETE") { mocks.noteDeleted = true; return {}; }
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

afterEach(() => {
  cleanup(); vi.clearAllMocks(); mocks.historyRole = "Setup crew"; mocks.noteText = "Bring back next year"; mocks.historyDeleted = false; mocks.noteDeleted = false; mocks.workerDeleted = false;
});

describe("ManagerWorkerPage", () => {
  it("shows saved manager notes", async () => {
    render(<ManagerWorkerPage workerId="worker-1" />);
    expect(await screen.findByText("Bring back next year")).toBeInTheDocument();
  });

  it("updates and removes work history immediately and uses short action labels", async () => {
    render(<ManagerWorkerPage workerId="worker-1" />);
    await screen.findByText("Setup crew");
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    fireEvent.change(screen.getByLabelText("Edit role"), { target: { value: "Lead setup" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Lead setup")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]);
    await waitFor(() => expect(screen.queryByText("Lead setup")).not.toBeInTheDocument());
  });

  it("edits and deletes manager notes immediately", async () => {
    render(<ManagerWorkerPage workerId="worker-1" />);
    await screen.findByText("Bring back next year");
    const editButtons = screen.getAllByRole("button", { name: "Edit" });
    fireEvent.click(editButtons[editButtons.length - 1]);
    fireEvent.change(screen.getByLabelText("Edit note"), { target: { value: "Call first next year" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Call first next year")).toBeInTheDocument();
    const deleteButtons = screen.getAllByRole("button", { name: "Delete" });
    fireEvent.click(deleteButtons[deleteButtons.length - 1]);
    await waitFor(() => expect(screen.queryByText("Call first next year")).not.toBeInTheDocument());
  });

  it("requires a named second confirmation before permanently deleting the worker", async () => {
    render(<ManagerWorkerPage workerId="worker-1" />);
    await screen.findByText("Jamie Worker");
    fireEvent.click(screen.getByRole("button", { name: "Delete worker" }));
    expect(mocks.workerDeleted).toBe(false);
    expect(screen.getByText(/work history, ratings, and manager notes will also be deleted/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete Jamie Worker" }));
    await waitFor(() => expect(mocks.workerDeleted).toBe(true));
  });
});
