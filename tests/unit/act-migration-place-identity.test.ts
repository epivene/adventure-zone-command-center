import { describe, expect, it } from "vitest";

import {
  groupExactPlaceDuplicates,
  normalizePlaceIdentity,
} from "@/features/act-migration/place-identity";

describe("place identity", () => {
  it("normalizes Unicode-safe case, whitespace, and harmless punctuation", () => {
    expect(normalizePlaceIdentity({
      name: "  CAFÉ—Hall, Inc.  ",
      location: "  123  Main St.,  Denver, CO  ",
    })).toEqual({
      name: "café hall inc",
      location: "123 main st denver co",
    });
  });

  it("groups only rows with the exact normalized name and location", () => {
    const rows = [
      { sourceId: "B", name: "Example Fair, Inc.", location: "Denver, CO" },
      { sourceId: "A", name: " example fair inc ", location: " denver co " },
      { sourceId: "C", name: "Example Fair Inc", location: "Austin, TX" },
    ];

    const groups = groupExactPlaceDuplicates(rows);

    expect([...groups.values()]).toEqual([
      [rows[2]],
      [rows[1], rows[0]],
    ]);
  });
});
