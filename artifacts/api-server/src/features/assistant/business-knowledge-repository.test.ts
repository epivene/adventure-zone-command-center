import { describe, expect, it } from "vitest";

import {
  filterBusinessKnowledge,
  initialBusinessKnowledgeSeed,
  type BusinessKnowledgeEntry,
} from "./business-knowledge-repository";

const entries: BusinessKnowledgeEntry[] = [
  {
    id: "global",
    seedKey: "global-flexibility",
    scope: "global",
    scopeRecordId: null,
    title: "Flexible packages",
    body: "Packages are guidelines and can be customized.",
    sourceUrl: null,
    sourceLabel: null,
    active: true,
    lastReviewedAt: null,
  },
  {
    id: "package-a",
    seedKey: "package-adventure-zone",
    scope: "package",
    scopeRecordId: "4fbc77e5-5453-42af-9316-b0ea6ca91ae5",
    title: "Adventure Zone",
    body: "Normal range is 10–12 main attractions.",
    sourceUrl: null,
    sourceLabel: null,
    active: true,
    lastReviewedAt: null,
  },
  {
    id: "inactive",
    seedKey: "inactive",
    scope: "global",
    scopeRecordId: null,
    title: "Old rule",
    body: "Do not use.",
    sourceUrl: null,
    sourceLabel: null,
    active: false,
    lastReviewedAt: null,
  },
];

describe("business knowledge", () => {
  it("includes active global and matching package knowledge only", () => {
    expect(
      filterBusinessKnowledge(entries, {
        packageTemplateIds: ["4fbc77e5-5453-42af-9316-b0ea6ca91ae5"],
        resourceIds: [],
        includeGlobal: true,
      }).map((entry) => entry.id),
    ).toEqual(["global", "package-a"]);
  });

  it("never uses inactive knowledge", () => {
    expect(
      filterBusinessKnowledge(entries, {
        packageTemplateIds: [],
        resourceIds: [],
        includeGlobal: true,
      }).map((entry) => entry.id),
    ).toEqual(["global"]);
  });

  it("ships stable, unique seed keys for approved business rules", () => {
    const keys = initialBusinessKnowledgeSeed.map((entry) => entry.seedKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain("package-adventure-zone-range");
    expect(keys).toContain("package-warriors-playground-range");
    expect(keys).toContain("package-pirates-rebellion-range");
    expect(keys).toContain("resource-paintball-shared");
    expect(keys).toContain("global-family-business-flexibility");
  });
});
