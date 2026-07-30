import packageJson from "@/package.json";
import { describe, expect, it } from "vitest";

import * as databaseSeed from "@/db/seed";
import { initialTravelLegs, seedTravelLegDefaults } from "@/db/seed";
import {
  packageTemplates,
  resourcePackageTags,
  resources,
} from "@/db/schema";

describe("database seed runner contract", () => {
  it("provides a supported TypeScript seed command for the four default legs", () => {
    expect(packageJson.scripts["db:seed"]).toBe("node --import tsx db/seed.ts");
    expect(initialTravelLegs).toEqual([
      { name: "Leg 1", color: "#DC3B3B", sortOrder: 1 },
      { name: "Leg 2", color: "#2F73D9", sortOrder: 2 },
      { name: "Leg 3", color: "#7B4DDB", sortOrder: 3 },
      { name: "Leg 4", color: "#15956B", sortOrder: 4 },
    ]);
  });

  it("adds only missing defaults without overwriting configured names or colors", async () => {
    const records = new Map([
      [
        1,
        { name: "North crew", color: "#123456", sortOrder: 1 },
      ],
    ]);
    const database = {
      insert: () => ({
        values: (values: typeof initialTravelLegs) => ({
          onConflictDoNothing: async () => {
            for (const value of values) {
              if (!records.has(value.sortOrder)) {
                records.set(value.sortOrder, { ...value });
              }
            }
          },
        }),
      }),
    };

    await seedTravelLegDefaults(database as never);

    expect([...records.values()]).toEqual([
      { name: "North crew", color: "#123456", sortOrder: 1 },
      { name: "Leg 2", color: "#2F73D9", sortOrder: 2 },
      { name: "Leg 3", color: "#7B4DDB", sortOrder: 3 },
      { name: "Leg 4", color: "#15956B", sortOrder: 4 },
    ]);
  });
});

describe("package and resource seed runner contract", () => {
  it("defines the three approved templates and one counted-once paintball resource", () => {
    expect(databaseSeed.initialPackageTemplates).toEqual([
      {
        code: "adventure_zone",
        name: "Adventure Zone",
        baseAttractionCount: 10,
      },
      {
        code: "weekend_warriors",
        name: "Weekend Warriors",
        baseAttractionCount: 5,
      },
      {
        code: "pirates_rebellion",
        name: "Pirates Rebellion",
        baseAttractionCount: 3,
      },
    ]);
    expect(databaseSeed.initialResources).toEqual([
      {
        code: "paintball_trailer",
        name: "Paintball trailer",
        category: "trailer",
        countsAsAttraction: true,
        movable: true,
      },
    ]);
    expect(databaseSeed.initialResourcePackageTags).toEqual([
      {
        resourceCode: "paintball_trailer",
        packageTemplateCode: "weekend_warriors",
      },
    ]);
  });

  it("adds stable-code defaults idempotently without overwriting operator edits", async () => {
    const state = {
      packageTemplates: new Map([
        [
          "adventure_zone",
          {
            id: "operator-package-id",
            code: "adventure_zone",
            name: "Operator label",
            baseAttractionCount: 12,
          },
        ],
      ]),
      resources: new Map([
        [
          "paintball_trailer",
          {
            id: "operator-resource-id",
            code: "paintball_trailer",
            name: "Operator trailer label",
            category: "trailer",
            countsAsAttraction: true,
            movable: true,
          },
        ],
      ]),
      tags: new Set<string>(),
    };
    let generatedId = 0;
    const database = {
      insert: (table: unknown) => ({
        values: (values: readonly Record<string, unknown>[]) => ({
          onConflictDoNothing: async () => {
            if (table === packageTemplates) {
              for (const value of values) {
                const code = String(value.code);
                if (!state.packageTemplates.has(code)) {
                  generatedId += 1;
                  state.packageTemplates.set(code, {
                    id: `generated-package-${generatedId}`,
                    code,
                    name: String(value.name),
                    baseAttractionCount: Number(value.baseAttractionCount),
                  });
                }
              }
            } else if (table === resources) {
              for (const value of values) {
                const code = String(value.code);
                if (!state.resources.has(code)) {
                  generatedId += 1;
                  state.resources.set(code, {
                    id: `generated-resource-${generatedId}`,
                    code,
                    name: String(value.name),
                    category: String(value.category),
                    countsAsAttraction: Boolean(value.countsAsAttraction),
                    movable: Boolean(value.movable),
                  });
                }
              }
            } else if (table === resourcePackageTags) {
              for (const value of values) {
                const resourceId = String(value.resourceId);
                const packageTemplateId = String(value.packageTemplateId);
                const packageTemplate = [...state.packageTemplates.values()]
                  .find(({ id }) => id === packageTemplateId);
                state.tags.add(`${resourceId}:${packageTemplate?.code}`);
              }
            }
          },
        }),
      }),
      select: () => ({
        from: (table: unknown) => ({
          where: async () => {
            if (table === packageTemplates) {
              return [...state.packageTemplates.values()].map(({ id, code }) => ({
                id,
                code,
              }));
            }
            return [...state.resources.values()].map(({ id, code }) => ({
              id,
              code,
            }));
          },
        }),
      }),
    };

    await databaseSeed.seedPackageResourceDefaults(
      database as never,
    );
    await databaseSeed.seedPackageResourceDefaults(
      database as never,
    );

    expect([...state.packageTemplates.values()]).toEqual([
      {
        id: "operator-package-id",
        code: "adventure_zone",
        name: "Operator label",
        baseAttractionCount: 12,
      },
      {
        id: expect.any(String),
        code: "weekend_warriors",
        name: "Weekend Warriors",
        baseAttractionCount: 5,
      },
      {
        id: expect.any(String),
        code: "pirates_rebellion",
        name: "Pirates Rebellion",
        baseAttractionCount: 3,
      },
    ]);
    expect([...state.resources.values()]).toEqual([
      {
        id: "operator-resource-id",
        code: "paintball_trailer",
        name: "Operator trailer label",
        category: "trailer",
        countsAsAttraction: true,
        movable: true,
      },
    ]);
    expect([...state.tags]).toEqual([
      "operator-resource-id:weekend_warriors",
    ]);
  });
});
