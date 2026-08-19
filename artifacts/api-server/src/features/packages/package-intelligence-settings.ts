import { sql } from "drizzle-orm";

import type { db as database } from "@/db/client";
import {
  packageTemplateInputSchema,
  type PackageTemplateInput,
} from "./package-input";
import {
  DrizzlePackageSettingsRepository,
} from "./package-repository";

export type PackageIntelligenceSettingsRecord = {
  id: string;
  code: string;
  name: string;
  basePriceCents: number | null;
  baseAttractionCount: number;
  minimumAttractionCount: number;
  maximumAttractionCount: number;
  customerDescription: string | null;
  bookingTalkingPoints: string | null;
  operationalRequirements: string | null;
  setupNotes: string | null;
  active: boolean;
};

export class PackageIntelligenceSettingsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PackageIntelligenceSettingsValidationError";
  }
}

type DrizzleDatabase = typeof database;

type IntelligenceRow = {
  id: string;
  base_price_cents: number | null;
  minimum_attraction_count: number | null;
  maximum_attraction_count: number | null;
  customer_description: string | null;
  booking_talking_points: string | null;
  operational_requirements: string | null;
  setup_notes: string | null;
};

function rowsOf<T>(result: unknown): T[] {
  if (result && typeof result === "object" && "rows" in result) {
    return ((result as { rows?: T[] }).rows ?? []);
  }
  return Array.isArray(result) ? (result as T[]) : [];
}

export class DrizzlePackageIntelligenceSettingsRepository {
  private readonly baseRepository: DrizzlePackageSettingsRepository;

  constructor(private readonly database: DrizzleDatabase) {
    this.baseRepository = new DrizzlePackageSettingsRepository(database);
  }

  async listPackageTemplates(): Promise<PackageIntelligenceSettingsRecord[]> {
    const [base, intelligenceResult] = await Promise.all([
      this.baseRepository.listPackageTemplates(),
      this.database.execute(sql`
        select
          id,
          base_price_cents,
          minimum_attraction_count,
          maximum_attraction_count,
          customer_description,
          booking_talking_points,
          operational_requirements,
          setup_notes
        from package_templates
      `),
    ]);
    const intelligenceById = new Map(
      rowsOf<IntelligenceRow>(intelligenceResult).map((row) => [row.id, row]),
    );

    return base.map((record) => {
      const extra = intelligenceById.get(record.id);
      return {
        ...record,
        basePriceCents: extra?.base_price_cents ?? null,
        minimumAttractionCount:
          extra?.minimum_attraction_count ?? record.baseAttractionCount,
        maximumAttractionCount:
          extra?.maximum_attraction_count ?? record.baseAttractionCount,
        customerDescription: extra?.customer_description ?? null,
        bookingTalkingPoints: extra?.booking_talking_points ?? null,
        operationalRequirements: extra?.operational_requirements ?? null,
        setupNotes: extra?.setup_notes ?? null,
      };
    });
  }

  async updatePackageTemplate(
    input: PackageTemplateInput,
    actorId: string,
  ): Promise<PackageIntelligenceSettingsRecord> {
    const parsed = packageTemplateInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new PackageIntelligenceSettingsValidationError(
        parsed.error.issues[0]?.message ?? "Review this package.",
      );
    }

    const data = parsed.data;
    const base = await this.baseRepository.updatePackageTemplate(data, actorId);
    await this.database.execute(sql`
      update package_templates
      set
        base_price_cents = ${data.basePriceCents},
        minimum_attraction_count = ${data.minimumAttractionCount},
        maximum_attraction_count = ${data.maximumAttractionCount},
        customer_description = ${data.customerDescription},
        booking_talking_points = ${data.bookingTalkingPoints},
        operational_requirements = ${data.operationalRequirements},
        setup_notes = ${data.setupNotes},
        updated_at = now()
      where id = ${data.id}::uuid
    `);

    return {
      ...base,
      basePriceCents: data.basePriceCents,
      minimumAttractionCount: data.minimumAttractionCount,
      maximumAttractionCount: data.maximumAttractionCount,
      customerDescription: data.customerDescription,
      bookingTalkingPoints: data.bookingTalkingPoints,
      operationalRequirements: data.operationalRequirements,
      setupNotes: data.setupNotes,
    };
  }
}
