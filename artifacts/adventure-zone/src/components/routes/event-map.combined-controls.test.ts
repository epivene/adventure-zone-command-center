import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/components/routes/event-map.tsx", "utf8");

describe("combined route map controls", () => {
  it("uses one filters disclosure and no travel-mode toggle", () => {
    expect(source).not.toContain("ManagerMapModeToggle");
    expect(source).not.toContain("Travel mode");
    expect(source).toContain("<summary");
    expect(source).toContain("Filters");
    expect(source).toContain("Route view");
    expect(source).toContain("Season/year");
    expect(source).toContain("Leg focus");
  });

  it("keeps navigation actions available in the combined view", () => {
    expect(source).toContain('<ManagerTripNavigationActions trip={focusedTrip} mode="on-road" />');
    expect(source).toContain('managerMode="on-road"');
  });
});
