import { and, eq, sql } from "drizzle-orm";
import type { db as database } from "@/db/client";
import {
  businessSourceDocuments,
  resourceSourceCandidates,
} from "@/db/schema";
import { ensureBusinessSourceSeed } from "@/features/business-sources/business-source-seed";
import {
  SOURCE_ASSETS,
  canApplySourceIdentity,
  classifyExactAssetMatch,
  normalizeAssetName,
} from "./resource-source-candidates";

type Database = typeof database;

type ResourceRow = {
  id: string;
  name: string;
  status: string;
  year_built: number | null;
  make: string | null;
  model: string | null;
  serial_number: string | null;
};

function rowsOf<T>(result: unknown): T[] {
  if (result && typeof result === "object" && "rows" in result) {
    return ((result as { rows?: T[] }).rows ?? []);
  }
  return Array.isArray(result) ? (result as T[]) : [];
}

export async function ensureResourceSourceCandidateSeed(database: Database): Promise<void> {
  await ensureBusinessSourceSeed(database);

  const source = (
    await database
      .select({ id: businessSourceDocuments.id })
      .from(businessSourceDocuments)
      .where(eq(businessSourceDocuments.originalFilename, "Inflatable List.pdf"))
      .limit(1)
  )[0];
  if (!source) throw new Error("INFLATABLE_SOURCE_DOCUMENT_MISSING");

  for (const asset of SOURCE_ASSETS) {
    await database
      .insert(resourceSourceCandidates)
      .values({
        sourceDocumentId: source.id,
        sourceName: asset.name,
        normalizedName: normalizeAssetName(asset.name),
        yearBuilt: asset.yearBuilt,
        make: asset.make,
        model: asset.model,
        serialNumber: asset.serialNumber,
        matchState: "pending",
      })
      .onConflictDoNothing({
        target: [
          resourceSourceCandidates.sourceDocumentId,
          resourceSourceCandidates.serialNumber,
        ],
      });
  }

  const resources = rowsOf<ResourceRow>(
    await database.execute(sql`
      select id, name, status, year_built, make, model, serial_number
      from resources
      where status <> 'archived'
      order by name, id
    `),
  );

  const candidates = await database
    .select()
    .from(resourceSourceCandidates)
    .where(
      and(
        eq(resourceSourceCandidates.sourceDocumentId, source.id),
        eq(resourceSourceCandidates.matchState, "pending"),
      ),
    );

  for (const candidate of candidates) {
    const sourceAsset = SOURCE_ASSETS.find(
      (asset) => asset.serialNumber === candidate.serialNumber,
    );
    if (!sourceAsset) continue;

    const match = classifyExactAssetMatch(candidate.sourceName, resources);
    if (!match.resourceId) {
      await database
        .update(resourceSourceCandidates)
        .set({
          matchedResourceId: null,
          matchState: "pending",
          matchNote: "No unique exact active resource-name match. Owner review required.",
          updatedAt: new Date(),
        })
        .where(eq(resourceSourceCandidates.id, candidate.id));
      continue;
    }

    const resource = resources.find((row) => row.id === match.resourceId);
    if (!resource) continue;
    const compatibility = canApplySourceIdentity(
      {
        yearBuilt: resource.year_built,
        make: resource.make,
        model: resource.model,
        serialNumber: resource.serial_number,
      },
      sourceAsset,
    );

    if (!compatibility.allowed) {
      await database
        .update(resourceSourceCandidates)
        .set({
          matchedResourceId: resource.id,
          matchState: "pending",
          matchNote: `Exact name match found, but existing identity conflicts in: ${compatibility.conflicts.join(", ")}.`,
          updatedAt: new Date(),
        })
        .where(eq(resourceSourceCandidates.id, candidate.id));
      continue;
    }

    await database.execute(sql`
      update resources
      set
        year_built = coalesce(year_built, ${sourceAsset.yearBuilt}),
        make = coalesce(make, ${sourceAsset.make}),
        model = coalesce(model, ${sourceAsset.model}),
        serial_number = coalesce(serial_number, ${sourceAsset.serialNumber}),
        updated_at = now()
      where id = ${resource.id}::uuid
    `);

    await database
      .update(resourceSourceCandidates)
      .set({
        matchedResourceId: resource.id,
        matchState: "applied",
        matchNote: "Exact unique resource-name match; blank identity fields were filled from the reviewed source list.",
        updatedAt: new Date(),
      })
      .where(eq(resourceSourceCandidates.id, candidate.id));
  }
}
