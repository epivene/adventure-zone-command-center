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

  it("ships reviewed website knowledge for package setup and pricing guidance", () => {
    const byKey = new Map(
      initialBusinessKnowledgeSeed.map((entry) => [entry.seedKey, entry]),
    );

    expect(byKey.get("package-adventure-zone-site-requirements")).toMatchObject({
      target: { kind: "package", code: "adventure_zone" },
      sourceUrl: "https://www.the-adventure-zone.com/general-5",
      sourceLabel: "Adventure Zone website FAQ",
    });
    expect(byKey.get("package-pirates-rebellion-site-requirements")).toMatchObject({
      target: { kind: "package", code: "pirates_rebellion" },
      sourceUrl: "https://www.the-adventure-zone.com/general-5",
    });
    expect(byKey.get("package-warriors-playground-site-requirements")).toMatchObject({
      target: { kind: "package", code: "weekend_warriors" },
      sourceUrl: "https://www.the-adventure-zone.com/general-5",
    });
    expect(byKey.get("global-event-pricing-model")).toMatchObject({
      target: { kind: "global" },
      sourceUrl: "https://www.the-adventure-zone.com/general-5",
    });

    expect(byKey.get("global-event-pricing-model")?.body).toMatch(/event-specific/i);
    expect(byKey.get("global-event-pricing-model")?.body).toMatch(/historical/i);
    expect(byKey.get("package-pirates-rebellion-site-requirements")?.body).toMatch(/2 days/i);
    expect(byKey.get("package-warriors-playground-site-requirements")?.body).toMatch(/25 KW/i);
  });

  it("identifies Amanda as the primary insurance contact and Sara as backup", () => {
    const insurance = initialBusinessKnowledgeSeed.find(
      (entry) => entry.seedKey === "global-insurance-contact",
    );
    expect(insurance?.body).toContain("Amanda Morton");
    expect(insurance?.body).toContain("amanda@protectiveins.net");
    expect(insurance?.body).toContain("Sara Toone");
    expect(insurance?.body).toContain("backup");
  });

});
