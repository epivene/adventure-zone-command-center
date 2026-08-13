import { describe, expect, it } from "vitest";
import {
  classifyOrganizationFamily,
  type OrganizationFamilyRecord,
} from "./organization-family-matcher";

const location = (
  overrides: Partial<OrganizationFamilyRecord> = {},
): OrganizationFamilyRecord => ({
  id: "location-reno",
  name: "Water Lantern Festival - Reno, NV",
  website: "https://www.waterlanternfestival.com/reno",
  address1: "2500 E 2nd St",
  city: "Reno",
  region: "NV",
  postalCode: "89595",
  ...overrides,
});

describe("classifyOrganizationFamily", () => {
  it("suggests same normalized base name plus shared website domain and different cities", () => {
    expect(
      classifyOrganizationFamily([
        location(),
        location({
          id: "location-salt-lake-city",
          name: "Water Lantern Festival (Salt Lake City) UT",
          website: "waterlanternfestival.com/salt-lake-city",
          address1: "110 S 400 W",
          city: "Salt Lake City",
          region: "UT",
          postalCode: "84101",
        }),
      ]),
    ).toEqual({
      kind: "location_family",
      groupKey: "organization-family:location-reno|location-salt-lake-city",
      candidateIds: ["location-reno", "location-salt-lake-city"],
      evidence: [
        { family: "name", label: "normalized base names agree" },
        { family: "website", label: "website domains agree" },
        { family: "location", label: "locations differ" },
      ],
    });
  });

  it("suggests shared website domain plus compatible ACT relationship and different cities", () => {
    expect(
      classifyOrganizationFamily([
        location({ actRelationshipIds: ["location-austin"] }),
        location({
          id: "location-austin",
          name: "Lantern Nights (Austin) TX",
          website: "https://waterlanternfestival.com/austin",
          address1: "800 W Riverside Dr",
          city: "Austin",
          region: "TX",
          postalCode: "78704",
        }),
      ]),
    ).toEqual({
      kind: "location_family",
      groupKey: "organization-family:location-austin|location-reno",
      candidateIds: ["location-austin", "location-reno"],
      evidence: [
        { family: "website", label: "website domains agree" },
        { family: "location", label: "locations differ" },
        {
          family: "act_relationship",
          label: "ACT organization relationships connect the records",
        },
      ],
    });
  });

  it("does not suggest similar names without another identity signal", () => {
    expect(
      classifyOrganizationFamily([
        location({ website: null }),
        location({
          id: "location-austin",
          name: "Water Lantern Festival (Austin) TX",
          website: null,
          address1: "800 W Riverside Dr",
          city: "Austin",
          region: "TX",
          postalCode: "78704",
        }),
      ]),
    ).toEqual({ kind: "insufficient" });
  });

  it("does not suggest records at the same address as different locations", () => {
    expect(
      classifyOrganizationFamily([
        location(),
        location({
          id: "location-sparks",
          name: "Water Lantern Festival (Sparks) NV",
          city: "Sparks",
        }),
      ]),
    ).toEqual({ kind: "insufficient" });
  });

  it("does not suggest conflicting website domains", () => {
    expect(
      classifyOrganizationFamily([
        location({ actRelationshipIds: ["location-austin"] }),
        location({
          id: "location-austin",
          name: "Water Lantern Festival (Austin) TX",
          website: "https://lanternfestival.example/austin",
          address1: "800 W Riverside Dr",
          city: "Austin",
          region: "TX",
          postalCode: "78704",
        }),
      ]),
    ).toEqual({ kind: "insufficient" });
  });

  it("produces a stable group key independent of record order", () => {
    const records = [
      location(),
      location({
        id: "location-salt-lake-city",
        name: "Water Lantern Festival (Salt Lake City) UT",
        address1: "110 S 400 W",
        city: "Salt Lake City",
        region: "UT",
        postalCode: "84101",
      }),
    ];

    expect(classifyOrganizationFamily(records)).toEqual(
      classifyOrganizationFamily([...records].reverse()),
    );
  });

  it("removes only explicit trailing location syntax from base names", () => {
    expect(
      classifyOrganizationFamily([
        location({ name: "Water Lantern Festival Reno" }),
        location({
          id: "location-austin",
          name: "Water Lantern Festival Austin",
          address1: "800 W Riverside Dr",
          city: "Austin",
          region: "TX",
          postalCode: "78704",
        }),
      ]),
    ).toEqual({ kind: "insufficient" });
  });
});
