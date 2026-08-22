import { eq } from "drizzle-orm";

import type { db as database } from "@/db/client";
import {
  businessSourceDocuments,
  businessSourceHistoricalTerms,
} from "@/db/schema";
import type { HistoricalTermValueType } from "@workspace/db/business-source-schema";
import { ensureBusinessSourceSeed } from "./business-source-seed";

export type HistoricalTermSeed = {
  termKey: string;
  label: string;
  valueText: string;
  valueType: HistoricalTermValueType;
  sourceLocator: string;
};

export const RAVALLI_TERMS: readonly HistoricalTermSeed[] = [
  { termKey: "event.name", label: "Event", valueText: "Ravalli County Fair", valueType: "text", sourceLocator: "Contract p.1" },
  { termKey: "event.location", label: "Location", valueText: "Hamilton, MT", valueType: "text", sourceLocator: "Contract p.1" },
  { termKey: "event.dates", label: "Event dates", valueText: "2025-08-27/2025-08-30", valueType: "date_range", sourceLocator: "Contract p.1" },
  { termKey: "contract.price_cents", label: "Negotiated convention rate", valueText: "630000", valueType: "money_cents", sourceLocator: "Contract p.1" },
  { termKey: "setup.arrival_date", label: "Permission to arrive", valueText: "2025-08-25", valueType: "date", sourceLocator: "Contract p.1" },
  { termKey: "setup.departure_through", label: "Permission to remain through", valueText: "2025-08-31", valueType: "date", sourceLocator: "Contract p.1" },
  { termKey: "site.camping", label: "Camping with attractions", valueText: "true", valueType: "boolean", sourceLocator: "Contract p.1" },
  { termKey: "site.power", label: "Power arrangement", valueText: "One 220-volt 50-amp outlet or five 110-volt outlets within 150 feet; contract also permits hardwire/spider boxes or a 20 kW generator", valueType: "text", sourceLocator: "Contract p.1" },
  { termKey: "site.water", label: "Water access", valueText: "One faucet within 150 feet for water rides and cleaning", valueType: "text", sourceLocator: "Contract p.1" },
  { termKey: "site.restrooms", label: "Restroom access", valueText: "24-hour restroom access from arrival through departure", valueType: "text", sourceLocator: "Contract p.1" },
  { termKey: "site.exclusivity", label: "Attraction exclusivity", valueText: "The Adventure Zone exclusive on all rides and games", valueType: "text", sourceLocator: "Contract p.1" },
  { termKey: "attractions.summary", label: "Attraction list", valueText: "10-12 inflatable attractions; 3-5 carnival-style games; access to 100-500 prizes, with additional fees when discounted/free to the public", valueType: "text", sourceLocator: "Contract p.1" },
];

export const HAWTHORNE_TERMS: readonly HistoricalTermSeed[] = [
  { termKey: "event.name", label: "Event", valueText: "75th Annual Armed Forces Day", valueType: "text", sourceLocator: "Vendor application p.1" },
  { termKey: "event.location", label: "Location", valueText: "Hawthorne, NV", valueType: "text", sourceLocator: "Vendor application p.1" },
  { termKey: "event.dates", label: "Event dates", valueText: "2026-05-12/2026-05-17", valueType: "date_range", sourceLocator: "Vendor application p.1" },
  { termKey: "application.deadline", label: "Application deadline", valueText: "2026-04-25", valueType: "date", sourceLocator: "Vendor application p.2" },
  { termKey: "application.water", label: "Vendor-form water note", valueText: "Water is available for use but must be hauled to the space; no hookups are available", valueType: "text", sourceLocator: "Vendor application p.1" },
  { termKey: "application.generator", label: "Generator disclosure", valueText: "Generator use must be disclosed because it affects placement", valueType: "text", sourceLocator: "Vendor application p.1" },
  { termKey: "application.setup", label: "Vendor setup window", valueText: "Vendor setup begins Tuesday at 9:00 AM; all vendors must be completely set up by Saturday at 10:00 AM", valueType: "text", sourceLocator: "Vendor application p.2" },
  { termKey: "application.booth_sizes_warning", label: "Booth-size interpretation", valueText: "10x10, 10x25, and 15x20 are normal vendor-form choices only and are not Adventure Zone package footprint approvals", valueType: "text", sourceLocator: "Reviewed source interpretation" },
];

type Database = typeof database;

async function seedDocumentTerms(
  database: Database,
  filename: string,
  terms: readonly HistoricalTermSeed[],
) {
  const [document] = await database
    .select({ id: businessSourceDocuments.id })
    .from(businessSourceDocuments)
    .where(eq(businessSourceDocuments.originalFilename, filename))
    .limit(1);
  if (!document) throw new Error(`BUSINESS_SOURCE_DOCUMENT_MISSING:${filename}`);

  for (const term of terms) {
    await database
      .insert(businessSourceHistoricalTerms)
      .values({
        sourceDocumentId: document.id,
        documentLinkId: null,
        termKey: term.termKey,
        label: term.label,
        valueText: term.valueText,
        valueType: term.valueType,
        sourceLocator: term.sourceLocator,
        reviewState: "proposed",
      })
      .onConflictDoNothing({
        target: [
          businessSourceHistoricalTerms.sourceDocumentId,
          businessSourceHistoricalTerms.termKey,
          businessSourceHistoricalTerms.sourceLocator,
        ],
      });
  }
}

export async function ensureEventDocumentTermSeed(database: Database): Promise<void> {
  await ensureBusinessSourceSeed(database);
  await seedDocumentTerms(database, "pirates rebellion contract.pdf", RAVALLI_TERMS);
  await seedDocumentTerms(database, "VENDOR APP 2026.docx", HAWTHORNE_TERMS);
}
