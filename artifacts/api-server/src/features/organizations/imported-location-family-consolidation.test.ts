import { describe, expect, it } from "vitest";

import {
  detectImportedLocationFamilies,
  splitLocationFamilyAssignments,
} from "./imported-location-family-consolidation";

describe("detectImportedLocationFamilies", () => {
  it("turns Water Lantern Festival city profiles into one canonical family", () => {
    const families = detectImportedLocationFamilies([
      row("a", "Water Lantern Festival Albuquerque NM"),
      row("b", "Water Lantern Festival (Billings) MT"),
      row("c", "Water Lantern Festival (Boise) ID"),
      row("d", "Water Lantern Festival Cache Valley (Logan) UT"),
    ]);

    expect(families).toEqual([
      {
        key: "waterlanternfestival.com:water-lantern-festival",
        canonicalName: "Water Lantern Festival",
        canonicalOrgId: null,
        locations: [
          { sourceOrgId: "a", label: "Albuquerque NM" },
          { sourceOrgId: "b", label: "Billings MT" },
          { sourceOrgId: "c", label: "Boise ID" },
          { sourceOrgId: "d", label: "Cache Valley Logan UT" },
        ],
      },
    ]);
  });

  it("uses an existing unsuffixed profile as canonical", () => {
    const families = detectImportedLocationFamilies([
      row("canonical", "Water Lantern Festival"),
      row("a", "Water Lantern Festival Albuquerque NM"),
      row("b", "Water Lantern Festival (Billings) MT"),
    ]);

    expect(families[0]?.canonicalOrgId).toBe("canonical");
    expect(
      families[0]?.locations.map((location) => location.sourceOrgId),
    ).toEqual(["a", "b"]);
  });

  it("does not combine weak or public-email matches", () => {
    expect(
      detectImportedLocationFamilies([
        row("a", "Water Lantern Festival Albuquerque NM", "same@gmail.com"),
        row("b", "Water Lantern Festival Billings MT", "same@gmail.com"),
        row("c", "Water Lantern Festival Boise ID", "same@gmail.com"),
      ]),
    ).toEqual([]);
    expect(
      detectImportedLocationFamilies([
        row("a", "Water Lantern Festival Albuquerque NM"),
        row("b", "Water Lantern Festival Billings MT"),
      ]),
    ).toEqual([]);
  });

  it("can use a matching business website when contacts have no email", () => {
    const families = detectImportedLocationFamilies([
      {
        ...row("a", "Water Lantern Festival Albuquerque NM", null),
        website: "https://waterlanternfestival.com/events",
      },
      {
        ...row("b", "Water Lantern Festival Billings MT", null),
        website: "https://www.waterlanternfestival.com",
      },
      {
        ...row("c", "Water Lantern Festival Boise ID", null),
        website: "waterlanternfestival.com",
      },
    ]);

    expect(families).toHaveLength(1);
    expect(families[0]?.canonicalName).toBe("Water Lantern Festival");
  });
});

describe("splitLocationFamilyAssignments", () => {
  it("never leaves a one-location final batch", () => {
    const assignments = Array.from({ length: 41 }, (_, index) => ({
      sourceOrgId: String(index),
      label: `Location ${index}`,
    }));

    expect(
      splitLocationFamilyAssignments(assignments).map((batch) => batch.length),
    ).toEqual([20, 19, 2]);
  });
});

function row(
  id: string,
  name: string,
  email = "events@waterlanternfestival.com",
) {
  return { id, name, city: null, region: null, email, website: null };
}
