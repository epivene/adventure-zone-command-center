import type { db as databaseClient } from "@/db/client";
import type { PackageIntelligenceSettingsRecord } from "./package-intelligence-settings";

export const PACKAGE_CODES = [
  "adventure_zone",
  "weekend_warriors",
  "pirates_rebellion",
  "mini_zone",
] as const;

export type CurrentPackageCode = (typeof PACKAGE_CODES)[number];

export type CurrentPackageOffer = {
  code: CurrentPackageCode;
  name: string;
  priceCents: number;
  attractionCount: number;
  marketingFootprint: string;
  customerDescription: string;
  bookingTalkingPoints: string;
  operationalRequirements: string;
  setupNotes: string;
};

export type CurrentOfferCatalog = {
  packages: Record<CurrentPackageCode, CurrentPackageOffer>;
  addOns: {
    foamParty: {
      code: "foam_party";
      name: "Foam Party Add-On";
      priceCents: 350000;
      availability: "add_on_only";
    };
  };
};

const CODE_ALIASES: Record<string, CurrentPackageCode> = {
  adventure_zone: "adventure_zone",
  weekend_warriors: "weekend_warriors",
  warriors_playground: "weekend_warriors",
  pirates_rebellion: "pirates_rebellion",
  pirate_rebellion: "pirates_rebellion",
  mini_zone: "mini_zone",
};

function footprintFrom(requirements: string | null): string {
  const match = requirements?.match(/\b\d{1,2},\d{3}[–-]\d{1,2},\d{3}\s+sq\s*ft\b/i);
  return match?.[0]?.replace("-", "–") ?? "";
}

export function buildCurrentOfferCatalog(
  records: PackageIntelligenceSettingsRecord[],
): CurrentOfferCatalog {
  const offers = new Map<CurrentPackageCode, CurrentPackageOffer>();
  for (const record of records) {
    const code = CODE_ALIASES[record.code];
    if (!code || !record.active) continue;
    if (record.basePriceCents === null) {
      throw new Error(`PACKAGE_PRICE_REQUIRED:${code}`);
    }
    const operationalRequirements = record.operationalRequirements ?? "";
    const marketingFootprint = footprintFrom(operationalRequirements);
    if (!marketingFootprint) {
      throw new Error(`PACKAGE_FOOTPRINT_REQUIRED:${code}`);
    }
    offers.set(code, {
      code,
      name: record.name,
      priceCents: record.basePriceCents,
      attractionCount: record.baseAttractionCount,
      marketingFootprint,
      customerDescription: record.customerDescription ?? "",
      bookingTalkingPoints: record.bookingTalkingPoints ?? "",
      operationalRequirements,
      setupNotes: record.setupNotes ?? "",
    });
  }

  for (const code of PACKAGE_CODES) {
    if (!offers.has(code)) throw new Error(`PACKAGE_REQUIRED:${code}`);
  }

  return {
    packages: Object.fromEntries(offers) as Record<CurrentPackageCode, CurrentPackageOffer>,
    addOns: {
      foamParty: {
        code: "foam_party",
        name: "Foam Party Add-On",
        priceCents: 350000,
        availability: "add_on_only",
      },
    },
  };
}

export async function loadCurrentOfferCatalog(
  database: typeof databaseClient,
): Promise<CurrentOfferCatalog> {
  const { DrizzlePackageIntelligenceSettingsRepository } = await import("./package-intelligence-settings");
  const repository = new DrizzlePackageIntelligenceSettingsRepository(database);
  return buildCurrentOfferCatalog(await repository.listPackageTemplates());
}
