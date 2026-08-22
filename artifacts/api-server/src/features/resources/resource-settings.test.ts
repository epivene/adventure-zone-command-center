import { describe, expect, it } from "vitest";

import {
  resourceChecklistTagValues,
  resourceInputSchema,
} from "./resource-input";

const validResource = {
  id: null,
  code: "sample_resource",
  name: "Sample Resource",
  category: "Inflatable",
  countsAsAttraction: true,
  packageCountCategory: "main_attraction" as const,
  packageTemplateIds: [],
  checklistTags: ["inflatable", "blower_powered"] as const,
  normalTravelLegId: null,
  movable: true,
  setupMinutes: 30,
  teardownMinutes: 30,
  minimumTransferMinutes: 60,
  status: "available" as const,
};

describe("resource checklist tags", () => {
  it("defines the approved inspection applicability tags", () => {
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

  it("accepts known checklist tags", () => {
    expect(resourceInputSchema.safeParse(validResource).success).toBe(true);
  });

  it("rejects unknown checklist tags", () => {
    expect(resourceInputSchema.safeParse({ ...validResource, checklistTags: ["inflatable", "mystery"] }).success).toBe(false);
  });

  it("rejects duplicate checklist tags", () => {
    expect(resourceInputSchema.safeParse({ ...validResource, checklistTags: ["inflatable", "inflatable"] }).success).toBe(false);
  });
});
