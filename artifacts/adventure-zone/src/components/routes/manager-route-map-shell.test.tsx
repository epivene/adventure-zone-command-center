// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import { applyLeafletViewport } from "./manager-route-map-shell";

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
