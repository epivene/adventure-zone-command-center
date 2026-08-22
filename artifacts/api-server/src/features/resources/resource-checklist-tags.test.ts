import { describe, expect, it } from "vitest";
import {
  resourceChecklistTagValues,
  resourceInputSchema,
} from "./resource-input";

const base = {
  id: null,
  code: "test_resource",
  name: "Test resource",
  category: "Inflatable",
  countsAsAttraction: true,
  packageCountCategory: "main_attraction" as const,
  packageTemplateIds: [],
  normalTravelLegId: null,
  movable: true,
  setupMinutes: 0,
  teardownMinutes: 0,
  minimumTransferMinutes: 0,
  status: "available" as const,
};

describe("resource checklist tags", () => {
  it("supports the approved checklist applicability vocabulary", () => {
    expect(resourceChecklistTagValues).toEqual([
      "inflatable",
      "blower_powered",
      "wet_attraction",
      "multi_section",
      "action_pursuit",
      "carnival_game",
      "trailer_shared",
    ]);
  });

  it("accepts unique known tags and rejects unknown or duplicated tags", () => {
    expect(resourceInputSchema.safeParse({ ...base, checklistTags: ["inflatable", "blower_powered"] }).success).toBe(true);
    expect(resourceInputSchema.safeParse({ ...base, checklistTags: ["mystery_tag"] }).success).toBe(false);
    expect(resourceInputSchema.safeParse({ ...base, checklistTags: ["inflatable", "inflatable"] }).success).toBe(false);
  });

  it("keeps checklist tags optional for legacy resource saves", () => {
    expect(resourceInputSchema.safeParse(base).success).toBe(true);
  });
});
