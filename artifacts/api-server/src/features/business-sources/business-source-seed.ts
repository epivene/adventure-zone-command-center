import type { db as database } from "@/db/client";
import { runBusinessDriveMigrations } from "@workspace/db/business-drive-migrations";

import {
  BusinessSourceRepository,
  type BusinessSourceConflictSeedRecord,
  type BusinessSourceSeedRecord,
} from "./business-source-repository";

export const BUSINESS_SOURCE_SEEDS = [
  {
    originalFilename: "ADVENTURE ZONE STICKY NOTES.docx.pdf",
    displayTitle: "Adventure Zone Sticky Notes",
    sourceCategory: "scripts_templates",
    effectiveYear: 2026,
    accessScope: "owner",
    storageReference: "amy-library/ADVENTURE ZONE STICKY NOTES.docx.pdf",
    notes:
      "Mixed historical and current scripts, package facts, internal notes, discounts, contacts, and ACT workflow. Reviewed selectively; never publish verbatim.",
  },
  {
    originalFilename: "Adventure Zone Attended Calendar.xlsx",
    displayTitle: "Adventure Zone Attended Calendar",
    sourceCategory: "attendance",
    effectiveYear: 2026,
    accessScope: "owner",
    notes:
      "Event attendance matrix. X means attended, B means blacklisted, and C means cancelled at the last minute. Match against existing profiles before creating anything new.",
  },
  {
    originalFilename: "Inflatable List.pdf",
    displayTitle: "Inflatable Asset List",
    sourceCategory: "inventory",
    effectiveYear: null,
    accessScope: "owner",
    notes:
      "Nine named inflatable assets with year built, make, model, and serial number. The list is not assumed to be the complete company inventory.",
  },
  {
    originalFilename: "Inflatables (carnival).docx.pdf",
    displayTitle: "Inflatable Inspection Checklist",
    sourceCategory: "operations",
    effectiveYear: null,
    accessScope: "manager",
    notes:
      "Base inspection categories and acceptable, needs-work-but-safe, and unsafe result meanings. Event checklists extend this source rather than copy its weekly grid.",
  },
  {
    originalFilename: "pirates rebellion contract.pdf",
    displayTitle: "Ravalli County Fair Pirate's Rebellion Contract",
    sourceCategory: "contract",
    effectiveYear: 2025,
    accessScope: "owner",
    notes:
      "Event-specific signed agreement and rider. Historical terms must not overwrite universal package defaults.",
  },
  {
    originalFilename: "VENDOR APP 2026.docx",
    displayTitle: "Hawthorne Armed Forces Day Vendor Application",
    sourceCategory: "vendor_application",
    effectiveYear: 2026,
    accessScope: "owner",
    notes:
      "Historical 2026 application and rules with an April 25, 2026 deadline. Normal vendor booth sizes are not Adventure Zone package footprints.",
  },
] as const satisfies readonly BusinessSourceSeedRecord[];

export const BUSINESS_SOURCE_CONFLICT_SEEDS = [
  {
    sourceFilename: "ADVENTURE ZONE STICKY NOTES.docx.pdf",
    factKey: "mini_zone.ballast.water_barrels",
    entityKind: "package",
    entityKey: "mini_zone",
    proposedValue: "44",
    normalizedValue: "44",
    sourceLocator: "Sticky Notes p.30",
    reviewState: "conflict",
    conflictGroup: "mini_zone_water_barrels",
  },
  {
    sourceFilename: "ADVENTURE ZONE STICKY NOTES.docx.pdf",
    factKey: "mini_zone.ballast.water_barrels",
    entityKind: "package",
    entityKey: "mini_zone",
    proposedValue: "50",
    normalizedValue: "50",
    sourceLocator: "Sticky Notes p.7",
    reviewState: "conflict",
    conflictGroup: "mini_zone_water_barrels",
  },
  {
    sourceFilename: "ADVENTURE ZONE STICKY NOTES.docx.pdf",
    factKey: "package.base_duration_days",
    entityKind: "package_rule",
    entityKey: null,
    proposedValue: "1-5",
    normalizedValue: "1-5",
    sourceLocator: "Older Sticky Notes templates",
    reviewState: "conflict",
    conflictGroup: "package_duration",
  },
  {
    sourceFilename: "ADVENTURE ZONE STICKY NOTES.docx.pdf",
    factKey: "package.base_duration_days",
    entityKind: "package_rule",
    entityKey: null,
    proposedValue: "1-4",
    normalizedValue: "1-4",
    sourceLocator: "2026 Sticky Notes pricing and templates",
    reviewState: "conflict",
    conflictGroup: "package_duration",
  },
  {
    sourceFilename: "ADVENTURE ZONE STICKY NOTES.docx.pdf",
    factKey: "payment.no_upfront_eligibility",
    entityKind: "commercial_rule",
    entityKey: null,
    proposedValue: "Multiple historical eligibility descriptions; owner review required.",
    normalizedValue: null,
    sourceLocator: "Sticky Notes pp.17-32",
    reviewState: "conflict",
    conflictGroup: "no_upfront_eligibility",
  },
] as const satisfies readonly BusinessSourceConflictSeedRecord[];

type Database = typeof database;

export async function ensureBusinessSourceSeed(database: Database): Promise<void> {
  await runBusinessDriveMigrations();
  const repository = new BusinessSourceRepository(database);
  await repository.seedSourceDocuments(BUSINESS_SOURCE_SEEDS);
  await repository.seedConflictFacts(BUSINESS_SOURCE_CONFLICT_SEEDS);
}
