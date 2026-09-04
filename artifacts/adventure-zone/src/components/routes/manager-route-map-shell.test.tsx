// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const mapObject = {
    setView: vi.fn(),
    fitBounds: vi.fn(),
    invalidateSize: vi.fn(),
    remove: vi.fn(),
  };
  const tileObject = {
    on: vi.fn(),
    addTo: vi.fn(),
  };
  tileObject.addTo.mockReturnValue(tileObject);
  return {
    mapObject,
    tileObject,
    map: vi.fn(() => mapObject),
    tileLayer: vi.fn(() => tileObject),
  };
});

vi.mock("leaflet", () => ({
  default: {
    map: mocks.map,
    tileLayer: mocks.tileLayer,
  },
}));

import { applyLeafletViewport, ManagerRouteMapShell } from "./manager-route-map-shell";

describe("applyLeafletViewport", () => {
  it("converts stored lng/lat into Leaflet lat/lng for a centered event", () => {
    const map = { setView: vi.fn(), fitBounds: vi.fn() };
    applyLeafletViewport(map as never, {
      kind: "center",
      center: [-105.8406, 46.4083],
      zoom: 11,
    });
    expect(map.setView).toHaveBeenCalledWith([46.4083, -105.8406], 11, { animate: false });
    expect(map.fitBounds).not.toHaveBeenCalled();
  });

  it("converts and fits multiple route points without using a world viewport", () => {
    const map = { setView: vi.fn(), fitBounds: vi.fn() };
    applyLeafletViewport(map as never, {
      kind: "bounds",
      coordinates: [[-105.8406, 46.4083], [-108.5007, 45.7833]],
    });
    expect(map.fitBounds).toHaveBeenCalledWith(
      [[46.4083, -105.8406], [45.7833, -108.5007]],
      { padding: [48, 48], maxZoom: 10, animate: false },
    );
    expect(map.setView).not.toHaveBeenCalled();
  });
});

describe("ManagerRouteMapShell lifecycle", () => {
  it("gives the route map enough vertical room on a phone", () => {
    render(<ManagerRouteMapShell viewport={{ kind: "none" }} />);
    expect(screen.getByRole("img", { name: "Adventure Zone route map" }).parentElement).toHaveClass("h-[32rem]");
  });

  it("does not recreate the Leaflet map when the tile-error callback identity changes", () => {
    mocks.map.mockClear();
    mocks.mapObject.remove.mockClear();

    const firstTileError = vi.fn();
    const { rerender } = render(
      <ManagerRouteMapShell
        viewport={{ kind: "center", center: [-105.8406, 46.4083], zoom: 10 }}
        onTileError={firstTileError}
      />,
    );

    expect(mocks.map).toHaveBeenCalledTimes(1);
    expect(mocks.mapObject.remove).not.toHaveBeenCalled();

    rerender(
      <ManagerRouteMapShell
        viewport={{ kind: "center", center: [-105.8406, 46.4083], zoom: 10 }}
        onTileError={() => undefined}
      />,
    );

    expect(mocks.map).toHaveBeenCalledTimes(1);
    expect(mocks.mapObject.remove).not.toHaveBeenCalled();
  });
});
