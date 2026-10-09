// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ManagerAuthProvider, useManagerAuth } from "./manager-auth-context";
import { clearCrewCache, pruneCrewAssignments } from "./manager-crew-cache";
vi.mock("./manager-crew-cache", () => ({ activateCrewCache: vi.fn(), clearCrewCache: vi.fn(async () => {}), pruneCrewAssignments: vi.fn(async () => {}) }));
vi.mock("./manager-sync-queue", () => ({ clearManagerPrivateData: vi.fn(async () => {}) }));
vi.mock("./manager-blob-queue", () => ({ clearManagerBlobData: vi.fn(async () => {}) }));
vi.mock("@/features/manager-assistant/manager-assistant-offline-cache", () => ({ clearManagerAssistantCache: vi.fn(async () => {}) }));

function Harness() {
  const { signIn, signOut, manager, loading } = useManagerAuth();
  return (
    <><p>{loading ? "Loading" : manager?.legId ?? "Signed out"}</p><button type="button" onClick={() => { void signIn("leg-kristy", "manager-secret"); }}>
      Sign in manager
    </button><button onClick={signOut}>Sign out manager</button></>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  localStorage.clear();
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
});

describe("manager auth context", () => {
  it("submits manager credentials only to the manager login endpoint", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          token: "manager-token",
          manager: { legId: "leg-kristy", legName: "Kristy", managerName: "Kristy" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    render(
      <ManagerAuthProvider>
        <Harness />
      </ManagerAuthProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Sign in manager" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(String(url)).toMatch(/\/api\/manager\/auth\/login$/);
    expect(String(url)).not.toMatch(/\/api\/auth\/login$/);
    expect(options).toMatchObject({
      method: "POST",
      body: JSON.stringify({ legId: "leg-kristy", password: "manager-secret" }),
    });
  });
  it("restores only the last leg on a connectivity failure and clears it on sign-out", async () => {
    localStorage.setItem("az_manager_token", "cached-token");
    localStorage.setItem("az_manager_offline_leg", JSON.stringify({ legId: "leg-offline", legName: "Offline leg" }));
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("No signal"));
    render(<ManagerAuthProvider><Harness /></ManagerAuthProvider>);
    await screen.findByText("leg-offline");
    fireEvent.click(screen.getByRole("button", { name: "Sign out manager" }));
    await screen.findByText("Signed out");
    expect(clearCrewCache).toHaveBeenCalledWith("leg-offline");
    expect(localStorage.getItem("az_manager_offline_leg")).toBeNull();
    expect(localStorage.getItem("az_manager_token")).toBeNull();
  });
  it("never restores private records after an authorization denial, even offline", async () => {
    localStorage.setItem("az_manager_token", "cached-token");
    localStorage.setItem("az_manager_offline_leg", JSON.stringify({ legId: "leg-offline", legName: "Offline leg" }));
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 401 }));
    render(<ManagerAuthProvider><Harness /></ManagerAuthProvider>);
    await screen.findByText("Signed out");
    expect(clearCrewCache).toHaveBeenCalledWith("leg-offline");
    expect(screen.queryByText("leg-offline")).toBeNull();
  });
  it("refreshes identity and assignments after reconnecting", async () => {
    localStorage.setItem("az_manager_token", "cached-token");
    localStorage.setItem("az_manager_offline_leg", JSON.stringify({ legId: "leg-offline", legName: "Offline leg" }));
    const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new TypeError("No signal"));
    render(<ManagerAuthProvider><Harness /></ManagerAuthProvider>);
    await screen.findByText("leg-offline");
    fetchMock.mockImplementation(async url => new Response(JSON.stringify(String(url).endsWith("/manager/map")
      ? { events: [{ bookingId: "still-assigned" }] }
      : { manager: { legId: "leg-offline", legName: "Offline leg", managerName: null } }), { status: 200 }));
    fireEvent(window, new Event("online"));
    await waitFor(() => expect(pruneCrewAssignments).toHaveBeenCalledWith("leg-offline", ["still-assigned"]));
  });
  it("purges the previous leg on a new leg login", async () => {
    localStorage.setItem("az_manager_offline_leg", JSON.stringify({ legId: "previous-leg", legName: "Previous" }));
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ token: "new-token", manager: { legId: "leg-kristy", legName: "Kristy", managerName: null } }), { status: 200 }));
    render(<ManagerAuthProvider><Harness /></ManagerAuthProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Sign in manager" }));
    await screen.findByText("leg-kristy");
    expect(clearCrewCache).toHaveBeenCalledWith("previous-leg");
  });
});
