import { pathToFileURL } from "node:url";

import { inArray } from "drizzle-orm";

import type { db as database } from "@/db/client";
import {
  packageTemplates,
  resourcePackageTags,
  resources,
  travelLegs,
} from "@/db/schema";

export const initialTravelLegs = [
  { name: "Leg 1", color: "#DC3B3B", sortOrder: 1 },
  { name: "Leg 2", color: "#2F73D9", sortOrder: 2 },
  { name: "Leg 3", color: "#7B4DDB", sortOrder: 3 },
  { name: "Leg 4", color: "#15956B", sortOrder: 4 },
  { name: "Leg 5", color: "#C77700", sortOrder: 5 },
  { name: "Leg 6", color: "#008B8B", sortOrder: 6 },
  { name: "Leg 7", color: "#B23A8A", sortOrder: 7 },
  { name: "Leg 8", color: "#4B6584", sortOrder: 8 },
  { name: "Leg 9", color: "#6B8E23", sortOrder: 9 },
] as const;

export const initialPackageTemplates = [
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
] as const;

export const initialResources = [
  {
    code: "paintball_trailer",
    name: "Paintball trailer",
    category: "trailer",
    countsAsAttraction: true,
    movable: true,
  },
] as const;

export const initialResourcePackageTags = [
  {
    resourceCode: "paintball_trailer",
    packageTemplateCode: "weekend_warriors",
  },
] as const;

type SeedDatabase = Pick<typeof database, "insert" | "select">;

export async function seedTravelLegDefaults(database: SeedDatabase) {
  await database
    .insert(travelLegs)
    .values([...initialTravelLegs])
    .onConflictDoNothing({
      target: travelLegs.sortOrder,
    });
}

export async function seedPackageResourceDefaults(database: SeedDatabase) {
  await database
    .insert(packageTemplates)
    .values([...initialPackageTemplates])
    .onConflictDoNothing({
      target: packageTemplates.code,
    });

  await database
    .insert(resources)
    .values([...initialResources])
    .onConflictDoNothing({
      target: resources.code,
    });

  const packageRows = await database
    .select({
      id: packageTemplates.id,
      code: packageTemplates.code,
    })
    .from(packageTemplates)
    .where(inArray(
      packageTemplates.code,
      initialPackageTemplates.map(({ code }) => code),
    ));
  const resourceRows = await database
    .select({
      id: resources.id,
      code: resources.code,
    })
    .from(resources)
    .where(inArray(
      resources.code,
      initialResources.map(({ code }) => code),
    ));

  const packageIdsByCode = new Map(
    packageRows.map(({ code, id }) => [code, id]),
  );
  const resourceIdsByCode = new Map(
    resourceRows.map(({ code, id }) => [code, id]),
  );
  const tagRows = initialResourcePackageTags.map((tag) => {
    const resourceId = resourceIdsByCode.get(tag.resourceCode);
    const packageTemplateId = packageIdsByCode.get(tag.packageTemplateCode);
    if (!resourceId || !packageTemplateId) {
      throw new Error(
        `Seed prerequisite is missing for ${tag.resourceCode}:${tag.packageTemplateCode}.`,
      );
    }
    return { resourceId, packageTemplateId };
  });

  await database
    .insert(resourcePackageTags)
    .values(tagRows)
    .onConflictDoNothing({
      target: [
        resourcePackageTags.resourceId,
        resourcePackageTags.packageTemplateId,
      ],
    });
}

export async function seedDatabaseDefaults() {
  const { db } = await import("@/db/client");
  await seedTravelLegDefaults(db);
  await seedPackageResourceDefaults(db);
}

const invokedFile = process.argv[1];

if (invokedFile && import.meta.url === pathToFileURL(invokedFile).href) {
  seedDatabaseDefaults().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
