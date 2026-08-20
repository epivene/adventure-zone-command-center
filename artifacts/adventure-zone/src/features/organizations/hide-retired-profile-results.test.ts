import { describe, expect, it } from "vitest";

import { hideRetiredProfileResults } from "./hide-retired-profile-results";

describe("hideRetiredProfileResults", () => {
  const page = {
    records: [
      { id: "live", name: "Live Fair", parentContext: null },
      { id: "retired", name: "Repeat Fair B", parentContext: { kind: "organization_group", id: "parent", name: "Double-Run Fairs" } },
    ],
    total: 2,
    page: 1,
    pageSize: 50,
    pageCount: 1,
  };

  it("removes consolidated source profiles from normal profile search results", () => {
    const result = hideRetiredProfileResults(page, false);
    expect(result.records.map((record) => record.id)).toEqual(["live"]);
  });

  it("leaves retired profiles visible when explicitly requested", () => {
    const result = hideRetiredProfileResults(page, true);
    expect(result.records.map((record) => record.id)).toEqual(["live", "retired"]);
  });
});
