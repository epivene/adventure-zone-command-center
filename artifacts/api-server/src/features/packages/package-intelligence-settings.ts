import { reconcileCapacityFacts } from "@/features/outreach-planner/outreach-commitments";
import { sql } from "drizzle-orm";

import type { db as database } from "@/db/client";
import { ensureDefaultPackageTemplates } from "./package-defaults";
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
  normalCapacity: number;
  temporaryUnavailableQuantity: number;
  minimumAttractionCount: number;
  maximumAttractionCount: number;
  baseDurationMinDays: number | null;
  baseDurationMaxDays: number | null;
  customerDescription: string | null;
  bookingTalkingPoints: string | null;
  operationalRequirements: string | null;
  setupNotes: string | null;
  knowledgeReviewNote: string | null;
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
  normal_capacity: number | null;
  temporary_unavailable_quantity: number | null;
  minimum_attraction_count: number | null;
  maximum_attraction_count: number | null;
  base_duration_min_days: number | null;
  base_duration_max_days: number | null;
  customer_description: string | null;
  booking_talking_points: string | null;
  operational_requirements: string | null;
  setup_notes: string | null;
  knowledge_review_note: string | null;
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

  private async ensureIntelligenceColumns(): Promise<void> {
    await this.database.execute(sql.raw(`
      DO $$
      DECLARE
        had_column boolean;
      BEGIN
        SELECT EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name = 'package_templates'
            AND column_name = 'base_price_cents'
        ) INTO had_column;

        IF NOT had_column THEN
          ALTER TABLE package_templates ADD COLUMN base_price_cents integer;

          UPDATE package_templates
          SET base_price_cents = 800000
          WHERE code = 'adventure_zone';

          UPDATE package_templates
          SET base_price_cents = 700000
          WHERE code IN ('pirates_rebellion', 'pirate_rebellion');
        END IF;
      END $$;

      ALTER TABLE package_templates
        ADD COLUMN IF NOT EXISTS base_duration_min_days integer,
        ADD COLUMN IF NOT EXISTS base_duration_max_days integer,
        ADD COLUMN IF NOT EXISTS knowledge_review_note text;

      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'package_templates_base_price_cents_nonnegative'
        ) THEN
          ALTER TABLE package_templates
            ADD CONSTRAINT package_templates_base_price_cents_nonnegative
              CHECK (base_price_cents IS NULL OR base_price_cents >= 0);
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'package_templates_base_duration_valid'
        ) THEN
          ALTER TABLE package_templates
            ADD CONSTRAINT package_templates_base_duration_valid
              CHECK (
                (base_duration_min_days IS NULL AND base_duration_max_days IS NULL)
                OR (
                  base_duration_min_days > 0
                  AND base_duration_max_days >= base_duration_min_days
                )
              );
        END IF;
      END $$;
    `));
  }

  async listPackageTemplates(): Promise<PackageIntelligenceSettingsRecord[]> {
    await this.ensureIntelligenceColumns();
    await ensureDefaultPackageTemplates(this.database);
    const [base, intelligenceResult] = await Promise.all([
      this.baseRepository.listPackageTemplates(),
      this.database.execute(sql`
        select
          id,
          base_price_cents,
          normal_capacity,
          temporary_unavailable_quantity,
          minimum_attraction_count,
          maximum_attraction_count,
          base_duration_min_days,
          base_duration_max_days,
          customer_description,
          booking_talking_points,
          operational_requirements,
          setup_notes,
          knowledge_review_note
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
        normalCapacity: extra?.normal_capacity ?? record.normalCapacity,
        temporaryUnavailableQuantity:
          extra?.temporary_unavailable_quantity ?? record.temporaryUnavailableQuantity,
        minimumAttractionCount:
          extra?.minimum_attraction_count ?? record.baseAttractionCount,
        maximumAttractionCount:
          extra?.maximum_attraction_count ?? record.baseAttractionCount,
        baseDurationMinDays: extra?.base_duration_min_days ?? null,
        baseDurationMaxDays: extra?.base_duration_max_days ?? null,
        customerDescription: extra?.customer_description ?? null,
        bookingTalkingPoints: extra?.booking_talking_points ?? null,
        operationalRequirements: extra?.operational_requirements ?? null,
        setupNotes: extra?.setup_notes ?? null,
        knowledgeReviewNote: extra?.knowledge_review_note ?? null,
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

    await this.ensureIntelligenceColumns();
    const data = parsed.data;
    const base = await this.baseRepository.updatePackageTemplate(data, actorId);
    await reconcileCapacityFacts(this.database,"package-inventory",async tx=>tx.execute(sql`
      update package_templates
      set
        base_price_cents = ${data.basePriceCents},
        normal_capacity = ${data.normalCapacity},
        temporary_unavailable_quantity = ${data.temporaryUnavailableQuantity},
        minimum_attraction_count = ${data.minimumAttractionCount},
        maximum_attraction_count = ${data.maximumAttractionCount},
        base_duration_min_days = ${data.baseDurationMinDays},
        base_duration_max_days = ${data.baseDurationMaxDays},
        customer_description = ${data.customerDescription},
        booking_talking_points = ${data.bookingTalkingPoints},
        operational_requirements = ${data.operationalRequirements},
        setup_notes = ${data.setupNotes},
        knowledge_review_note = ${data.knowledgeReviewNote},
        updated_at = now()
      where id = ${data.id}::uuid
    `));

    return {
      ...base,
      basePriceCents: data.basePriceCents,
      normalCapacity: data.normalCapacity,
      temporaryUnavailableQuantity: data.temporaryUnavailableQuantity,
      minimumAttractionCount: data.minimumAttractionCount,
      maximumAttractionCount: data.maximumAttractionCount,
      baseDurationMinDays: data.baseDurationMinDays,
      baseDurationMaxDays: data.baseDurationMaxDays,
      customerDescription: data.customerDescription,
      bookingTalkingPoints: data.bookingTalkingPoints,
      operationalRequirements: data.operationalRequirements,
      setupNotes: data.setupNotes,
      knowledgeReviewNote: data.knowledgeReviewNote,
    };
  }
}
