import { describe, expect, it } from "vitest";

import {
  DrizzlePackageSettingsRepository,
} from "@/features/packages/package-repository";
import {
  DrizzleResourceSettingsRepository,
} from "@/features/resources/resource-repository";

const now = new Date("2026-07-29T00:00:00.000Z");

const resourceAlpha = {
  id: "11111111-1111-4111-8111-111111111111",
  code: "alpha",
  name: "Alpha",
  category: "equipment",
  countsAsAttraction: false,
  movable: false,
  normalTravelLegId: null,
  setupMinutes: 0,
  teardownMinutes: 0,
  minimumTransferMinutes: 0,
  status: "available" as const,
  createdAt: now,
  updatedAt: now,
};

const resourceBeta = {
  ...resourceAlpha,
  id: "22222222-2222-4222-8222-222222222222",
  code: "beta",
  name: "Beta",
};

describe("package/resource settings repository queries", () => {
  it("loads ordered resources and sorted tags from one joined statement", async () => {
    let selectCount = 0;
    let leftJoinCount = 0;
    const joinedRows = [
      {
        resource: resourceAlpha,
        packageTemplateId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      },
      {
        resource: resourceAlpha,
        packageTemplateId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      },
      {
        resource: resourceBeta,
        packageTemplateId: null,
      },
    ];
    const standaloneResources = [resourceAlpha, resourceBeta];
    const standaloneTags = [
      {
        resourceId: resourceAlpha.id,
        packageTemplateId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      },
      {
        resourceId: resourceAlpha.id,
        packageTemplateId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      },
    ];
    const database = {
      select() {
        selectCount += 1;
        const currentSelect = selectCount;
        return {
          from() {
            return {
              leftJoin() {
                leftJoinCount += 1;
                return {
                  orderBy: async () => joinedRows,
                };
              },
              orderBy: async () =>
                currentSelect === 1 ? standaloneResources : standaloneTags,
            };
          },
        };
      },
    };

    const records = await new DrizzleResourceSettingsRepository(
      database as never,
    ).listResources();

    expect(selectCount).toBe(1);
    expect(leftJoinCount).toBe(1);
    expect(records).toEqual([
      {
        id: resourceAlpha.id,
        code: "alpha",
        name: "Alpha",
        category: "equipment",
        countsAsAttraction: false,
        movable: false,
        normalTravelLegId: null,
        setupMinutes: 0,
        teardownMinutes: 0,
        minimumTransferMinutes: 0,
        status: "available",
        packageTemplateIds: [
          "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        ],
      },
      {
        id: resourceBeta.id,
        code: "beta",
        name: "Beta",
        category: "equipment",
        countsAsAttraction: false,
        movable: false,
        normalTravelLegId: null,
        setupMinutes: 0,
        teardownMinutes: 0,
        minimumTransferMinutes: 0,
        status: "available",
        packageTemplateIds: [],
      },
    ]);
  });

  it("keeps the package actor out of before and records it in after", async () => {
    const current = {
      id: "33333333-3333-4333-8333-333333333333",
      code: "adventure_zone",
      name: "Adventure Zone",
      baseAttractionCount: 10,
      active: true,
    };
    const updated = {
      ...current,
      name: "Adventure Zone Deluxe",
      active: false,
    };
    const auditRows: Record<string, unknown>[] = [];
    const transaction = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => ({
              for: async () => [current],
            }),
          }),
        }),
      }),
      update: () => ({
        set: () => ({
          where: () => ({
            returning: async () => [updated],
          }),
        }),
      }),
      insert: () => ({
        values: async (row: Record<string, unknown>) => {
          auditRows.push(row);
        },
      }),
    };
    const database = {
      transaction<T>(
        operation: (writer: typeof transaction) => Promise<T>,
      ): Promise<T> {
        return operation(transaction);
      },
    };

    await new DrizzlePackageSettingsRepository(
      database as never,
    ).updatePackageTemplate({
      id: current.id,
      name: updated.name,
      baseAttractionCount: updated.baseAttractionCount,
      active: updated.active,
    }, "owner_1");

    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.before).toEqual({
      code: "adventure_zone",
      name: "Adventure Zone",
      baseAttractionCount: 10,
      active: true,
    });
    expect(auditRows[0]?.after).toEqual({
      code: "adventure_zone",
      name: "Adventure Zone Deluxe",
      baseAttractionCount: 10,
      active: false,
      actorId: "owner_1",
    });
  });

  it("keeps the resource actor out of before and records it in after", async () => {
    const currentTag = {
      id: "44444444-4444-4444-8444-444444444444",
      packageTemplateId: "55555555-5555-4555-8555-555555555555",
    };
    const saved = {
      ...resourceAlpha,
      name: "Alpha updated",
      updatedAt: new Date("2026-07-29T01:00:00.000Z"),
    };
    const auditRows: Record<string, unknown>[] = [];
    let selectCount = 0;
    const transaction = {
      select: () => {
        selectCount += 1;
        const result =
          selectCount === 1
            ? [resourceAlpha]
            : selectCount === 2
              ? [currentTag]
              : [{ id: currentTag.packageTemplateId, active: true }];
        const selection = {
          then<TResult1 = typeof result>(
            onfulfilled?: ((value: typeof result) => TResult1) | null,
          ) {
            return Promise.resolve(
              onfulfilled ? onfulfilled(result) : (result as TResult1),
            );
          },
          limit: () => ({
            for: async () => result,
          }),
          for: async () => result,
        };
        return {
          from: () => ({
            where: () => selection,
          }),
        };
      },
      update: () => ({
        set: () => ({
          where: () => ({
            returning: async () => [saved],
          }),
        }),
      }),
      delete: () => ({
        where: async () => undefined,
      }),
      insert: () => ({
        values: async (row: Record<string, unknown>) => {
          auditRows.push(row);
        },
      }),
    };
    const database = {
      transaction<T>(
        operation: (writer: typeof transaction) => Promise<T>,
      ): Promise<T> {
        return operation(transaction);
      },
    };

    await new DrizzleResourceSettingsRepository(
      database as never,
    ).upsertResource({
      id: resourceAlpha.id,
      code: resourceAlpha.code,
      name: saved.name,
      category: saved.category,
      countsAsAttraction: saved.countsAsAttraction,
      packageTemplateIds: [currentTag.packageTemplateId],
      normalTravelLegId: null,
      movable: saved.movable,
      setupMinutes: saved.setupMinutes,
      teardownMinutes: saved.teardownMinutes,
      minimumTransferMinutes: saved.minimumTransferMinutes,
      status: saved.status,
    }, "owner_1");

    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.before).toEqual({
      code: "alpha",
      name: "Alpha",
      category: "equipment",
      countsAsAttraction: false,
      packageTemplateIds: [currentTag.packageTemplateId],
      normalTravelLegId: null,
      movable: false,
      setupMinutes: 0,
      teardownMinutes: 0,
      minimumTransferMinutes: 0,
      status: "available",
    });
    expect(auditRows[0]?.after).toEqual({
      code: "alpha",
      name: "Alpha updated",
      category: "equipment",
      countsAsAttraction: false,
      packageTemplateIds: [currentTag.packageTemplateId],
      normalTravelLegId: null,
      movable: false,
      setupMinutes: 0,
      teardownMinutes: 0,
      minimumTransferMinutes: 0,
      status: "available",
      actorId: "owner_1",
    });
  });
});
