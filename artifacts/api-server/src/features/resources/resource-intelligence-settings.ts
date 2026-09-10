import { reconcileCapacityFacts } from "@/features/outreach-planner/outreach-commitments";
import { sql } from "drizzle-orm";

import type { db as database } from "@/db/client";
import {
  resourceInputSchema,
  type PackageCountCategory,
  type ResourceChecklistTag,
  type ResourceInput,
} from "./resource-input";
import {
  DrizzleResourceSettingsRepository,
  type ResourceInventoryRecord,
} from "./resource-repository";

export type ResourceIntelligenceInventoryRecord = ResourceInventoryRecord & {
  packageCountCategory: PackageCountCategory;
  checklistTags: ResourceChecklistTag[];
  yearBuilt: number | null;
  make: string | null;
  model: string | null;
  serialNumber: string | null;
  inspectionIdentityNotes: string | null;
};

type DrizzleDatabase = typeof database;
type IntelligenceRow = {
  id: string;
  package_count_category: PackageCountCategory;
  checklist_tags: ResourceChecklistTag[] | null;
  year_built: number | null;
  make: string | null;
  model: string | null;
  serial_number: string | null;
  inspection_identity_notes: string | null;
};

function rowsOf<T>(result: unknown): T[] {
  if (result && typeof result === "object" && "rows" in result) {
    return ((result as { rows?: T[] }).rows ?? []);
  }
  return Array.isArray(result) ? (result as T[]) : [];
}

export class DrizzleResourceIntelligenceSettingsRepository {
  private readonly baseRepository: DrizzleResourceSettingsRepository;

  constructor(private readonly database: DrizzleDatabase) {
    this.baseRepository = new DrizzleResourceSettingsRepository(database);
  }

  async listResources(): Promise<ResourceIntelligenceInventoryRecord[]> {
    const [base, intelligenceResult] = await Promise.all([
      this.baseRepository.listResources(),
      this.database.execute(sql`
        select
          id,
          package_count_category,
          checklist_tags,
          year_built,
          make,
          model,
          serial_number,
          inspection_identity_notes
        from resources
      `),
    ]);
    const intelligenceById = new Map(
      rowsOf<IntelligenceRow>(intelligenceResult).map((row) => [row.id, row]),
    );
    return base.map((resource) => {
      const identity = intelligenceById.get(resource.id);
      return {
        ...resource,
        packageCountCategory: identity?.package_count_category ?? "main_attraction",
        checklistTags: identity?.checklist_tags ?? [],
        yearBuilt: identity?.year_built ?? null,
        make: identity?.make ?? null,
        model: identity?.model ?? null,
        serialNumber: identity?.serial_number ?? null,
        inspectionIdentityNotes: identity?.inspection_identity_notes ?? null,
      };
    });
  }

  async upsertResource(
    input: ResourceInput,
    actorId: string,
  ): Promise<ResourceIntelligenceInventoryRecord> {
    const parsed = resourceInputSchema.parse(input);
    const base = await this.baseRepository.upsertResource(parsed, actorId);

    await reconcileCapacityFacts(this.database,"resource-inventory",async tx=>tx.execute(sql`
      update resources
      set
        package_count_category = ${parsed.packageCountCategory},
        checklist_tags = coalesce(${parsed.checklistTags ?? null}::text[], checklist_tags),
        year_built = ${parsed.yearBuilt},
        make = ${parsed.make},
        model = ${parsed.model},
        serial_number = ${parsed.serialNumber},
        inspection_identity_notes = ${parsed.inspectionIdentityNotes},
        updated_at = now()
      where id = ${base.id}::uuid
    `));

    const current = rowsOf<IntelligenceRow>(
      await this.database.execute(sql`
        select
          id,
          package_count_category,
          checklist_tags,
          year_built,
          make,
          model,
          serial_number,
          inspection_identity_notes
        from resources
        where id = ${base.id}::uuid
      `),
    )[0];
    return {
      ...base,
      packageCountCategory: current?.package_count_category ?? parsed.packageCountCategory,
      checklistTags: current?.checklist_tags ?? [],
      yearBuilt: current?.year_built ?? null,
      make: current?.make ?? null,
      model: current?.model ?? null,
      serialNumber: current?.serial_number ?? null,
      inspectionIdentityNotes: current?.inspection_identity_notes ?? null,
    };
  }
}
