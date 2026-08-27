import { describe, expect, it } from "vitest";

import { organizationListQuerySchema } from "./last-resort-input";
import { sortOrganizationRecords, type ProfileSortMetadata } from "./organization-list-sort";

const records = [
  { id: "a", name: "Bravo Fair" },
  { id: "b", name: "Alpha Festival" },
  { id: "c", name: "Charlie Days" },
];

const metadata = new Map<string, ProfileSortMetadata>([
  ["a", { createdAt: new Date("2025-01-01T00:00:00Z"), lastChangedAt: new Date("2026-08-10T00:00:00Z") }],
  ["b", { createdAt: new Date("2026-01-01T00:00:00Z"), lastChangedAt: new Date("2026-08-25T00:00:00Z") }],
  ["c", { createdAt: new Date("2024-01-01T00:00:00Z"), lastChangedAt: new Date("2026-07-01T00:00:00Z") }],
]);

describe("organization list sorting", () => {
  it("defaults to recently updated", () => {
    const query = organizationListQuerySchema.parse({});
    expect(query.sort).toBe("recently_updated");
  });

  it("accepts every supported directory sort", () => {
    for (const sort of [
      "recently_updated",
      "least_recently_updated",
      "name_asc",
      "name_desc",
      "created_desc",
      "created_asc",
    ] as const) {
      expect(organizationListQuerySchema.parse({ sort }).sort).toBe(sort);
    }
  });

  it("orders by the latest meaningful profile change", () => {
    expect(sortOrganizationRecords(records, metadata, "recently_updated").map((record) => record.id)).toEqual(["b", "a", "c"]);
    expect(sortOrganizationRecords(records, metadata, "least_recently_updated").map((record) => record.id)).toEqual(["c", "a", "b"]);
  });

  it("supports alphabetical and creation-date ordering", () => {
    expect(sortOrganizationRecords(records, metadata, "name_asc").map((record) => record.id)).toEqual(["b", "a", "c"]);
    expect(sortOrganizationRecords(records, metadata, "name_desc").map((record) => record.id)).toEqual(["c", "a", "b"]);
    expect(sortOrganizationRecords(records, metadata, "created_desc").map((record) => record.id)).toEqual(["b", "a", "c"]);
    expect(sortOrganizationRecords(records, metadata, "created_asc").map((record) => record.id)).toEqual(["c", "a", "b"]);
  });
});
