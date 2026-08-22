import { describe, expect, it } from "vitest";

import { resourceInputSchema } from "./resource-input";

const validResource = {
  id: null,
  code: "labyrinth_maze",
  name: "Labyrinth Maze",
  category: "Inflatable",
  countsAsAttraction: true,
  packageCountCategory: "main_attraction" as const,
  packageTemplateIds: [],
  checklistTags: ["inflatable"] as const,
  normalTravelLegId: null,
  movable: true,
  setupMinutes: 0,
  teardownMinutes: 0,
  minimumTransferMinutes: 0,
  status: "available" as const,
};

describe("resource asset identity", () => {
  it("accepts source identity metadata without changing operational fields", () => {
    const parsed = resourceInputSchema.safeParse({
      ...validResource,
      yearBuilt: 2019,
      make: "Inflatable",
      model: "Maze",
      serialNumber: "001",
      inspectionIdentityNotes: null,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toMatchObject({
        yearBuilt: 2019,
        make: "Inflatable",
        model: "Maze",
        serialNumber: "001",
        inspectionIdentityNotes: null,
        status: "available",
        setupMinutes: 0,
      });
    }
  });

  it("rejects impossible source years", () => {
    expect(resourceInputSchema.safeParse({ ...validResource, yearBuilt: 1800 }).success).toBe(false);
    expect(resourceInputSchema.safeParse({ ...validResource, yearBuilt: 2101 }).success).toBe(false);
  });

  it("keeps identity fields backwards-compatible for legacy resource writers", () => {
    const parsed = resourceInputSchema.parse(validResource);
    expect(parsed.yearBuilt).toBeNull();
    expect(parsed.make).toBeNull();
    expect(parsed.model).toBeNull();
    expect(parsed.serialNumber).toBeNull();
    expect(parsed.inspectionIdentityNotes).toBeNull();
  });
});
