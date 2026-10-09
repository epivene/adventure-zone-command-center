// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ManagerCrewTravelCard } from "./manager-crew-travel-card";
import { crewApi } from "@/components/profiles/crew-location-api";
import { getCrewSnapshot, removeCrewSnapshot, saveCrewSnapshot } from "@/lib/manager-crew-cache";
const auth = vi.hoisted(() => ({ legId: "leg-a" }));
vi.mock("@/lib/manager-auth-context", () => ({ useManagerAuth: () => ({ managerApi, manager: { legId: auth.legId } }) }));
vi.mock("@/lib/manager-crew-cache", () => ({
  crewCacheEpoch: () => 0, getCrewSnapshot: vi.fn(), removeCrewSnapshot: vi.fn(async () => {}),
  saveCrewSnapshot: vi.fn(async () => ({ loadedAt: "2026-10-09T12:00:00Z" })),
}));
const managerApi = vi.fn();
vi.mock("@/components/profiles/festival-crew-map", () => ({ FestivalCrewMap: () => <div>Map preview</div> }));
vi.mock("@/components/profiles/crew-location-api", async importOriginal => {
  const o = await importOriginal<typeof import("@/components/profiles/crew-location-api")>();
  return { ...o, crewApi: { getForManager: vi.fn() } };
});
const stop = { id: "s1", updatedAt: "x", name: "QA Walmart", category: "walmart", address: "1 Main", latitude: 1, longitude: 2, sourceKey: "n/1", sourceUrl: "https://osm.org/n/1", phone: "555", website: "javascript:alert(1)", notes: "Ask manager", rigFit: "unknown", hookups: "unknown", overnight: "unknown", maxRigLengthFeet: null, expectedUpdatedAt: null };
const ok = (name: string) => ({ bookingId: "b", year: 2026, crewLocation: { venue: name, editionUpdatedAt: null, location: null, stops: [stop] } });
beforeEach(() => { vi.clearAllMocks(); auth.legId = "leg-a"; vi.mocked(getCrewSnapshot).mockResolvedValue(null); Object.defineProperty(navigator, "onLine", { configurable: true, value: true }); });
afterEach(() => { cleanup(); Object.defineProperty(navigator, "onLine", { configurable: true, value: true }); });
describe("ManagerCrewTravelCard", () => {
  it("shows saved facts read-only with unknown preserved and unsafe links dropped", async () => {
    vi.mocked(crewApi.getForManager).mockResolvedValue(ok("Venue A") as never);
    render(<ManagerCrewTravelCard bookingId="b" />);
    await screen.findByText("QA Walmart");
    expect(crewApi.getForManager).toHaveBeenCalledWith("b", managerApi);
    expect(screen.getByText("Ask manager")).toBeTruthy();
    expect(screen.getAllByText("Unknown").length).toBe(4);
    expect(screen.getByRole("link", { name: /Source listing/ })).toBeTruthy();
    expect(screen.queryByText("Website")).toBeNull();
    expect(screen.queryByRole("button", { name: /save|add|delete/i })).toBeNull();
  });
  it("shows error then retries", async () => {
    vi.mocked(crewApi.getForManager).mockRejectedValueOnce(new Error("Boom")).mockResolvedValueOnce(ok("Venue A") as never);
    render(<ManagerCrewTravelCard bookingId="b" />);
    await screen.findByText("Boom");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByText("QA Walmart");
  });
  it("handles unlinked and clears stale data, ignoring obsolete responses", async () => {
    let resolveA: (v: never) => void = () => undefined;
    vi.mocked(crewApi.getForManager).mockImplementationOnce(() => new Promise(r => { resolveA = r as never; }))
      .mockResolvedValueOnce({ bookingId: "c", year: null, crewLocation: null });
    const { rerender } = render(<ManagerCrewTravelCard bookingId="a" />);
    rerender(<ManagerCrewTravelCard bookingId="c" />);
    await screen.findByText(/no linked festival profile/);
    resolveA(ok("Old venue") as never);
    await Promise.resolve();
    expect(screen.queryByText("QA Walmart")).toBeNull();
    expect(screen.queryByText(/Old venue/)).toBeNull();
  });
  it("loads saved read-only text offline, marks it stale and refreshes on reconnect", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    vi.mocked(getCrewSnapshot).mockResolvedValue({ key: "k", legId: "leg-a", loadedAt: "2026-10-08T12:00:00Z", data: ok("Saved venue") } as never);
    render(<ManagerCrewTravelCard bookingId="b" />);
    await screen.findByText("QA Walmart");
    expect(crewApi.getForManager).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("Offline / stale");
    expect(screen.getByText(/Last loaded/)).toBeTruthy();
    expect(screen.getByText("Directions destination: 1, 2")).toBeTruthy();
    expect(screen.getAllByText("Unknown")).toHaveLength(4);
    expect(screen.queryByText("Map preview")).toBeNull();
    vi.mocked(crewApi.getForManager).mockResolvedValue(ok("Fresh venue") as never);
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    fireEvent(window, new Event("online"));
    await screen.findByText("Fresh venue");
    expect(saveCrewSnapshot).toHaveBeenCalled();
    expect(screen.queryByText(/Offline \/ stale/)).toBeNull();
  });
  it.each([401, 403, 404])("deletes revoked snapshots on HTTP %s, never falling back", async status => {
    vi.mocked(crewApi.getForManager).mockRejectedValue(Object.assign(new Error("Access revoked"), { status }));
    render(<ManagerCrewTravelCard bookingId="b" />);
    await screen.findByText("Access revoked");
    expect(removeCrewSnapshot).toHaveBeenCalledWith("leg-a", "b");
    expect(getCrewSnapshot).not.toHaveBeenCalled();
    expect(screen.queryByText("QA Walmart")).toBeNull();
  });
  it("does not fall back on server errors", async () => {
    vi.mocked(crewApi.getForManager).mockRejectedValue(Object.assign(new Error("Server error"), { status: 500 }));
    render(<ManagerCrewTravelCard bookingId="b" />);
    await screen.findByText("Server error");
    expect(getCrewSnapshot).not.toHaveBeenCalled();
  });
});
