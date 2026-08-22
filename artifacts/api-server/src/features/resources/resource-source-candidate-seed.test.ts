import { describe, expect, it } from "vitest";

import {
  SOURCE_ASSETS,
  normalizeAssetName,
  classifyExactAssetMatch,
  canApplySourceIdentity,
} from "./resource-source-candidates";

describe("inflatable source candidates", () => {
  it("preserves all nine source assets exactly", () => {
    expect(SOURCE_ASSETS).toHaveLength(9);
    expect(SOURCE_ASSETS[0]).toEqual({
      name: "Labyrinth Maze",
      yearBuilt: 2019,
      make: "Inflatable",
      model: "Maze",
      serialNumber: "001",
    });
    expect(SOURCE_ASSETS[8]?.serialNumber).toBe("009");
  });

  it("normalizes names conservatively", () => {
    expect(normalizeAssetName("Take Me Out To The Ballgame")).toBe("take me out to the ballgame");
    expect(normalizeAssetName("  Choo-Choo   Playhouse! ")).toBe("choo choo playhouse");
  });

  it("auto-matches only one exact normalized active resource", () => {
    expect(classifyExactAssetMatch("Labyrinth Maze", [
      { id: "a", name: "Labyrinth Maze", status: "available" },
    ])).toEqual({ state: "exact_match", resourceId: "a" });
    expect(classifyExactAssetMatch("Labyrinth Maze", [])).toEqual({ state: "pending", resourceId: null });
    expect(classifyExactAssetMatch("Labyrinth Maze", [
      { id: "a", name: "Labyrinth Maze", status: "available" },
      { id: "b", name: "Labyrinth-Maze", status: "maintenance" },
    ])).toEqual({ state: "pending", resourceId: null });
    expect(classifyExactAssetMatch("Labyrinth Maze", [
      { id: "a", name: "Labyrinth Maze", status: "archived" },
    ])).toEqual({ state: "pending", resourceId: null });
  });

  it("applies only blank or identical identity fields", () => {
    const source = SOURCE_ASSETS[0]!;
    expect(canApplySourceIdentity({ yearBuilt: null, make: null, model: null, serialNumber: null }, source)).toEqual({ allowed: true, conflicts: [] });
    expect(canApplySourceIdentity({ yearBuilt: 2019, make: "Inflatable", model: "Maze", serialNumber: "001" }, source).allowed).toBe(true);
    const conflict = canApplySourceIdentity({ yearBuilt: 2018, make: "Inflatable", model: "Maze", serialNumber: "001" }, source);
    expect(conflict.allowed).toBe(false);
    expect(conflict.conflicts).toContain("yearBuilt");
  });
});
