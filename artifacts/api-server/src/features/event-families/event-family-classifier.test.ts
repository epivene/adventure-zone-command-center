import { describe, expect, it } from "vitest";
import { classifyName, classifyObviousEventFamilies } from "./event-family-classifier";

describe("event family classifier", () => {
  it("normalizes reviewed holiday aliases", () => {
    expect(classifyName("Bismarck 4th of July Celebration")?.normalizedName).toBe("fourth of july");
    expect(classifyName("Mandan Independence Day Parade")?.normalizedName).toBe("fourth of july");
    expect(classifyName("Dickinson Fourth of July Festival")?.normalizedName).toBe("fourth of july");
    expect(classifyName("Downtown Octoberfest")?.normalizedName).toBe("oktoberfest");
    expect(classifyName("Oktoberfest USA")?.normalizedName).toBe("oktoberfest");
    expect(classifyName("Christmas Hardware Store")).toBeNull();
  });

  it("requires two distinct unassigned profiles", () => {
    const proposals = classifyObviousEventFamilies([
      { id: "a", name: "Bismarck 4th of July Celebration", placeType: "festival_event", city: "Bismarck", region: "ND" },
      { id: "a", name: "Mandan Independence Day Parade", placeType: "festival_event", city: "Mandan", region: "ND" },
      { id: "b", name: "Dickinson Fourth of July Festival", placeType: "festival_event", city: "Dickinson", region: "ND", eventFamilyId: "existing" },
    ]);
    expect(proposals).toEqual([]);
  });

  it("creates a deterministic proposal for multiple aliases", () => {
    const proposals = classifyObviousEventFamilies([
      { id: "a", name: "Bismarck 4th of July Celebration", placeType: "festival_event", city: "Bismarck", region: "ND" },
      { id: "b", name: "Mandan Independence Day Parade", placeType: "festival_event", city: "Mandan", region: "ND" },
    ]);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({ normalizedName: "fourth of july", source: "rule", confidence: 1 });
    expect(proposals[0]?.candidateIds).toEqual(["a", "b"]);
  });
});
