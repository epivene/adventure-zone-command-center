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
};

type DrizzleDatabase = typeof database;
type IntelligenceRow = {
  id: string;
  package_count_category: PackageCountCategory;
  checklist_tags: ResourceChecklistTag[] | null;
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
        select id, package_count_category, checklist_tags
        from resources
      `),
    ]);
    const intelligenceById = new Map(
      rowsOf<IntelligenceRow>(intelligenceResult).map((row) => [row.id, row]),
    );
    return base.map((resource) => ({
      ...resource,
      packageCountCategory:
        intelligenceById.get(resource.id)?.package_count_category ?? "main_attraction",
      checklistTags: intelligenceById.get(resource.id)?.checklist_tags ?? [],
    }));
  }

  async upsertResource(
    input: ResourceInput,
    actorId: string,
  ): Promise<ResourceIntelligenceInventoryRecord> {
    const parsed = resourceInputSchema.parse(input);
    const base = await this.baseRepository.upsertResource(parsed, actorId);

    if (parsed.checklistTags !== undefined) {
      await this.database.execute(sql`
        update resources
        set
          package_count_category = ${parsed.packageCountCategory},
          checklist_tags = ${parsed.checklistTags}::text[],
          updated_at = now()
        where id = ${base.id}::uuid
      `);
    } else {
      await this.database.execute(sql`
        update resources
        set package_count_category = ${parsed.packageCountCategory}, updated_at = now()
        where id = ${base.id}::uuid
      `);
    }

    const current = rowsOf<IntelligenceRow>(
      await this.database.execute(sql`
        select id, package_count_category, checklist_tags
        from resources
        where id = ${base.id}::uuid
      `),
    )[0];
    return {
      ...base,
      packageCountCategory: current?.package_count_category ?? parsed.packageCountCategory,
      checklistTags: current?.checklist_tags ?? [],
    };
  }
}
