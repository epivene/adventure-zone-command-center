import { sql } from "drizzle-orm";

import type { db as database } from "@/db/client";
import {
  resourceInputSchema,
  type PackageCountCategory,
  type ResourceInput,
} from "./resource-input";
import {
  DrizzleResourceSettingsRepository,
  type ResourceInventoryRecord,
} from "./resource-repository";

export type ResourceIntelligenceInventoryRecord = ResourceInventoryRecord & {
  packageCountCategory: PackageCountCategory;
};

type DrizzleDatabase = typeof database;
type CountRow = { id: string; package_count_category: PackageCountCategory };

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
    const [base, categoryResult] = await Promise.all([
      this.baseRepository.listResources(),
      this.database.execute(sql`
        select id, package_count_category
        from resources
      `),
    ]);
    const categoryById = new Map(
      rowsOf<CountRow>(categoryResult).map((row) => [row.id, row.package_count_category]),
    );
    return base.map((resource) => ({
      ...resource,
      packageCountCategory: categoryById.get(resource.id) ?? "main_attraction",
    }));
  }

  async upsertResource(
    input: ResourceInput,
    actorId: string,
  ): Promise<ResourceIntelligenceInventoryRecord> {
    const parsed = resourceInputSchema.parse(input);
    const base = await this.baseRepository.upsertResource(parsed, actorId);
    await this.database.execute(sql`
      update resources
      set package_count_category = ${parsed.packageCountCategory}, updated_at = now()
      where id = ${base.id}::uuid
    `);
    return { ...base, packageCountCategory: parsed.packageCountCategory };
  }
}
