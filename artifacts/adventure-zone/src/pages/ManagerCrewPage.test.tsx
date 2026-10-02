// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ManagerCrewPage from "./ManagerCrewPage";

const mocks = vi.hoisted(() => ({
  api: vi.fn(async (path: string, init?: RequestInit) => {
    if (path === "/manager/dashboard") {
      return { events: [{ id: "event-1", name: "Fargo Fair", city: "Fargo", region: "ND" }] };
    }
    if (path.startsWith("/manager/crew") && (!init || init.method === "GET")) {
      return {
        workers: [
          {
            id: "worker-1",
            name: "Jamie Worker",
            phone: "701-555-1234",
            email: null,
            city: "Fargo",
            region: "ND",
            locationText: "Fargo, ND",
            rehireStatus: "do_not_rehire",
            workHistory: [{ id: "h1", legId: "leg-old", role: "Setup crew", rating: 4, note: "Worked 2025 fair" }],
            managerNotes: [],
          },
        ],
      };
    }
    if (path === "/manager/crew" && init?.method === "POST") {
      return { worker: { id: "worker-new", name: "New Worker" }, possibleMatches: [] };
    }
    return {};
  }),
}));

vi.mock("@/lib/manager-auth-context", () => ({
  useOptionalManagerAuth: () => ({ managerApi: mocks.api }),
  useManagerAuth: () => ({
    manager: { legId: "leg-a", legName: "Leg A", managerName: "Manager" },
    managerApi: mocks.api,
  }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ManagerCrewPage", () => {
  it("offers next-event location lookup and shows rehire warnings/history", async () => {
    render(<ManagerCrewPage />);
    expect(await screen.findByRole("button", { name: /Find workers near Fargo/i })).toBeInTheDocument();
    expect(await screen.findByText("Jamie Worker")).toBeInTheDocument();
    expect(screen.getByText(/Do Not Rehire/i)).toBeInTheDocument();
    expect(screen.getByText(/Setup crew/i)).toBeInTheDocument();
  });

  it("searches by city and region", async () => {
    render(<ManagerCrewPage />);
    await screen.findByText("Jamie Worker");
    fireEvent.change(screen.getByLabelText("Crew city"), { target: { value: "Fargo" } });
    fireEvent.change(screen.getByLabelText("Crew region"), { target: { value: "ND" } });
    fireEvent.click(screen.getByRole("button", { name: "Search crew" }));
    await waitFor(() =>
      expect(mocks.api).toHaveBeenCalledWith("/manager/crew?city=Fargo&region=ND"),
    );
  });

  it("adds a new worker", async () => {
    render(<ManagerCrewPage />);
    await screen.findByText("Jamie Worker");
    fireEvent.click(screen.getByRole("button", { name: "Add worker" }));
    fireEvent.change(screen.getByLabelText("Worker name"), { target: { value: "New Worker" } });
    fireEvent.click(screen.getByRole("button", { name: "Save worker" }));
    await waitFor(() =>
      expect(mocks.api).toHaveBeenCalledWith(
        "/manager/crew",
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });
});
