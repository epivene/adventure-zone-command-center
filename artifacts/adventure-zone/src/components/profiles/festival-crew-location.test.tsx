// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FestivalCrewLocation } from "./festival-crew-location";
import { crewApi, directionsUrl, suggestionToInput } from "./crew-location-api";
vi.mock("./festival-crew-map", () => ({ FestivalCrewMap: () => <div>Map preview</div> }));
vi.mock("./crew-location-api", async importOriginal => {
  const original = await importOriginal<typeof import("./crew-location-api")>();
  return { ...original, crewApi: { get: vi.fn(), searchVenue: vi.fn(), savePin: vi.fn(), nearby: vi.fn(), createStop: vi.fn(), updateStop: vi.fn(), removeStop: vi.fn() } };
});
const timestamp = "2026-10-09T00:00:00.000Z";
const initial = { venue: "Actual event venue", editionUpdatedAt: timestamp, location: { latitude: 43.7, longitude: -116.35, displayName: "Actual event venue" }, stops: [] };
const suggestion = { sourceKey: "node/12", name: "QA Walmart", category: "walmart" as const, address: "123 Example Street", latitude: 43.7, longitude: -116.35, sourceUrl: "https://www.openstreetmap.org/node/12", phone: "", website: "", distanceMiles: 1 };
beforeEach(() => { vi.clearAllMocks(); vi.mocked(crewApi.get).mockResolvedValue(initial); });
afterEach(cleanup);
describe("year-scoped crew location composition", () => {
  it("loads saved records without automatically calling external providers", async () => {
    render(<FestivalCrewLocation organizationId="test" year={2026} onEditionChanged={vi.fn()} />);
    await screen.findByText("Actual event venue");
    expect(crewApi.searchVenue).not.toHaveBeenCalled(); expect(crewApi.nearby).not.toHaveBeenCalled();
    expect(screen.getByRole("region", { name: "Saved crew stops" })).toBeTruthy();
  });
  it("preserves a manual stop draft when saving fails", async () => {
    vi.mocked(crewApi.createStop).mockRejectedValue(new Error("Server temporarily unavailable"));
    const editing = vi.fn();
    render(<FestivalCrewLocation organizationId="test" year={2026} onEditionChanged={vi.fn()} onEditingChange={editing} />);
    await screen.findByText("Actual event venue");
    fireEvent.click(screen.getByRole("button", { name: /add crew stop/i }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "QA RV campground" } });
    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "Call to confirm long rigs" } });
    fireEvent.click(screen.getByRole("button", { name: /save crew stop/i }));
    await screen.findByText("Server temporarily unavailable");
    expect(screen.getByDisplayValue("Call to confirm long rigs")).toBeTruthy();
    expect(vi.mocked(crewApi.createStop).mock.calls[0][2]).toMatchObject({ latitude: null, longitude: null, overnight: "unknown", sourceKey: null });
    expect(editing).toHaveBeenCalledWith(true);
  });
  it("shows manual entry when lookup fails rather than substituting organizer location", async () => {
    vi.mocked(crewApi.get).mockResolvedValue({ ...initial, location: null });
    vi.mocked(crewApi.searchVenue).mockRejectedValue(new Error("Lookup unavailable"));
    render(<FestivalCrewLocation organizationId="test" year={2026} onEditionChanged={vi.fn()} />);
    await screen.findByText("Actual event venue");
    fireEvent.click(screen.getByRole("button", { name: /find venue on map/i }));
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await screen.findByText(/Lookup unavailable/);
    expect(screen.getByLabelText("Latitude")).toBeTruthy();
    expect(crewApi.savePin).not.toHaveBeenCalled();
  });
  it("never converts an OSM Walmart result into overnight permission", () => {
    expect(suggestionToInput(suggestion)).toMatchObject({ rigFit: "unknown", hookups: "unknown", overnight: "unknown" });
    expect(directionsUrl(suggestion)).toBe("https://www.google.com/maps/dir/?api=1&destination=43.7,-116.35");
    expect(directionsUrl({ latitude: null, longitude: null, address: "" })).toBeNull();
  });
  it("keeps a successful saved stop visible even if the subsequent refresh fails", async () => {
    vi.mocked(crewApi.get).mockResolvedValueOnce(initial).mockRejectedValueOnce(new Error("Refresh unavailable"));
    vi.mocked(crewApi.createStop).mockResolvedValue({ ...suggestionToInput({ ...suggestion, name: "QA visible stop" }), id: "new-stop", expectedUpdatedAt: timestamp, updatedAt: timestamp });
    render(<FestivalCrewLocation organizationId="test" year={2026} onEditionChanged={vi.fn()} />);
    await screen.findByText("Actual event venue");
    fireEvent.click(screen.getByRole("button", { name: /add crew stop/i }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "QA visible stop" } });
    fireEvent.click(screen.getByRole("button", { name: /save crew stop/i }));
    await screen.findByText("QA visible stop");
    await screen.findByText(/Could not refresh: Refresh unavailable/);
    expect(screen.getByText("Crew stop saved.")).toBeTruthy();
  });
  it("does not display a stop-centered map until this annual venue has a confirmed pin", async () => {
    vi.mocked(crewApi.get).mockResolvedValue({ ...initial, location: null, stops: [{ ...suggestionToInput(suggestion), id: "existing-stop", expectedUpdatedAt: timestamp, updatedAt: timestamp }] });
    render(<FestivalCrewLocation organizationId="test" year={2026} onEditionChanged={vi.fn()} />);
    await screen.findByText("QA Walmart");
    expect(screen.queryByRole("button", { name: "Show map" })).toBeNull();
    expect(screen.getByText("Directions")).toBeTruthy();
  });
});
