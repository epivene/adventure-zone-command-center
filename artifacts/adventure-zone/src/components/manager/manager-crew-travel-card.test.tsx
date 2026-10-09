// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ManagerCrewTravelCard } from "./manager-crew-travel-card";
import { crewApi } from "@/components/profiles/crew-location-api";
vi.mock("@/lib/manager-auth-context", () => ({ useManagerAuth: () => ({ managerApi }) }));
const managerApi = vi.fn();
vi.mock("@/components/profiles/festival-crew-map", () => ({ FestivalCrewMap: () => <div>Map preview</div> }));
vi.mock("@/components/profiles/crew-location-api", async importOriginal => {
  const o = await importOriginal<typeof import("@/components/profiles/crew-location-api")>();
  return { ...o, crewApi: { getForManager: vi.fn() } };
});
const stop = { id: "s1", updatedAt: "x", name: "QA Walmart", category: "walmart", address: "1 Main", latitude: 1, longitude: 2, sourceKey: "n/1", sourceUrl: "https://osm.org/n/1", phone: "555", website: "javascript:alert(1)", notes: "Ask manager", rigFit: "unknown", hookups: "unknown", overnight: "unknown", maxRigLengthFeet: null, expectedUpdatedAt: null };
const ok = (name: string) => ({ bookingId: "b", year: 2026, crewLocation: { venue: name, editionUpdatedAt: null, location: null, stops: [stop] } });
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);
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
});
