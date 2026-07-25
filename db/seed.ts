import { pathToFileURL } from "node:url";

import { sql } from "drizzle-orm";

import { travelLegs } from "@/db/schema";

export const initialTravelLegs = [
  { name: "Leg 1", color: "#DC3B3B", sortOrder: 1 },
  { name: "Leg 2", color: "#2F73D9", sortOrder: 2 },
  { name: "Leg 3", color: "#7B4DDB", sortOrder: 3 },
  { name: "Leg 4", color: "#15956B", sortOrder: 4 },
] as const;

export async function seedTravelLegs() {
  const { db } = await import("@/db/client");

  await db
    .insert(travelLegs)
    .values([...initialTravelLegs])
    .onConflictDoUpdate({
      target: travelLegs.sortOrder,
      set: {
        name: sql`excluded.name`,
        color: sql`excluded.color`,
        updatedAt: sql`now()`,
      },
    });
}

const invokedFile = process.argv[1];

if (invokedFile && import.meta.url === pathToFileURL(invokedFile).href) {
  seedTravelLegs().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
