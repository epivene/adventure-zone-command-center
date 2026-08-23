import { describe, expect, it } from "vitest";

import {
  organizationListQuerySchema,
  profileTypesForDirectoryView,
} from "./last-resort-input";

describe("profile directory view", () => {
  it("parses the broad directory mode separately from exact profile type", () => {
    const query = organizationListQuerySchema.parse({ view: "events", type: "fair" });
    expect(query.directoryView).toBe("events");
    expect(query.placeType).toBe("fair");
  });

  it("groups fairs and festival/events into Events", () => {
    expect(profileTypesForDirectoryView("events")).toEqual(["fair", "festival_event"]);
  });

  it("groups non-event place types into Organizations", () => {
    expect(profileTypesForDirectoryView("organizations")).toEqual([
      "city_government",
      "venue",
      "school",
      "tribe",
      "association",
      "company",
      "other",
    ]);
  });

  it("does not constrain the All view", () => {
    expect(profileTypesForDirectoryView("all")).toBeNull();
  });
});
