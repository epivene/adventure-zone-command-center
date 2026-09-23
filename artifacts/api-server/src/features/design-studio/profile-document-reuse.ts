import { and, desc, eq } from "drizzle-orm";

import type { db as database } from "@/db/client";
import { recordAuditEntry } from "@/features/audit/audit-service";
import { loadCurrentOfferCatalog } from "@/features/packages/current-offer-catalog";
import {
  designProjectVersions,
  designProjects,
  designSmartFields,
  designTemplates,
} from "@workspace/db/design-studio-schema";

export const RECONFIRMATION_FIELD_KEYS = new Set([
  "event_name",
  "event_dates",
  "event_location",
  "operating_hours",
  "guaranteed_fee",
  "percentage",
  "deposit",
  "balance_due",
  "due_date",
  "availability",
  "sponsor_signature",
  "adventure_zone_signature",
]);

const STRUCTURED_RECONFIRMATION_KEYS = new Set([
  "eventName",
  "eventDates",
  "eventLocation",
  "operatingHours",
  "guaranteedFee",
  "percentage",
  "deposit",
  "balanceDue",
  "dueDate",
  "availability",
  "signatures",
]);

function money(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function clearStructured(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(clearStructured);
  if (!value || typeof value !== "object") return value;
  const source = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(source).map(([key, item]) => [
      key,
      STRUCTURED_RECONFIRMATION_KEYS.has(key)
        ? (key === "signatures" ? { sponsor: "", adventureZone: "" } : "")
        : clearStructured(item),
    ]),
  );
}

export function clearReconfirmationContent(
  content: string,
  smartFields: Array<{ fieldKey: string; valueSnapshot: string | null; overriddenValue?: string | null }>,
): string {
  let cleared = content;
  try {
    return JSON.stringify(clearStructured(JSON.parse(content)), null, 2);
  } catch {
    for (const field of smartFields) {
      if (!RECONFIRMATION_FIELD_KEYS.has(field.fieldKey)) continue;
      const value = field.overriddenValue || field.valueSnapshot;
      if (value) cleared = cleared.replaceAll(value, `{{${field.fieldKey}}}`);
    }
    return cleared;
  }
}

function parseCatalogSnapshot(value: string | null | undefined): Record<string, any> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, any>
      : null;
  } catch {
    return null;
  }
}

export function refreshOfferFacts(
  content: string,
  previousSnapshot: Record<string, any> | null,
  currentSnapshot: Record<string, any>,
): string {
  let refreshed = content;
  const previousPackages = previousSnapshot?.packages ?? {};
  const currentPackages = currentSnapshot.packages ?? {};
  for (const [code, current] of Object.entries<any>(currentPackages)) {
    const previous = previousPackages[code];
    if (!previous) continue;
    if (previous.priceCents !== current.priceCents) {
      refreshed = refreshed.replaceAll(money(previous.priceCents), money(current.priceCents));
    }
    if (previous.marketingFootprint && previous.marketingFootprint !== current.marketingFootprint) {
      refreshed = refreshed.replaceAll(previous.marketingFootprint, current.marketingFootprint);
    }
  }
  const previousFoam = previousSnapshot?.addOns?.foamParty;
  const currentFoam = currentSnapshot?.addOns?.foamParty;
  if (previousFoam?.priceCents && currentFoam?.priceCents && previousFoam.priceCents !== currentFoam.priceCents) {
    refreshed = refreshed.replaceAll(money(previousFoam.priceCents), money(currentFoam.priceCents));
  }
  return refreshed;
}

export class ProfileDocumentReuseError extends Error {
  constructor(public readonly code: "PROJECT_NOT_FOUND" | "CURRENT_DRAFT" | "SOURCE_TEMPLATE_NOT_FOUND") {
    super(code);
    this.name = "ProfileDocumentReuseError";
  }
}

export async function reuseProfileDocument(
  database: typeof database,
  input: { accountId: string; projectId: string; documentYear: number },
) {
  const [source] = await database
    .select()
    .from(designProjects)
    .where(and(
      eq(designProjects.id, input.projectId),
      eq(designProjects.officeAccountId, input.accountId),
    ))
    .limit(1);
  if (!source) throw new ProfileDocumentReuseError("PROJECT_NOT_FOUND");
  if (source.status === "draft" || source.status === "ready") {
    throw new ProfileDocumentReuseError("CURRENT_DRAFT");
  }
  if (!source.sourceTemplateId || !source.linkedOrganizationId) {
    throw new ProfileDocumentReuseError("SOURCE_TEMPLATE_NOT_FOUND");
  }

  const [sourceTemplate] = await database
    .select()
    .from(designTemplates)
    .where(eq(designTemplates.id, source.sourceTemplateId))
    .limit(1);
  if (!sourceTemplate?.catalogKey) {
    throw new ProfileDocumentReuseError("SOURCE_TEMPLATE_NOT_FOUND");
  }

  const [currentTemplate] = await database
    .select()
    .from(designTemplates)
    .where(and(
      eq(designTemplates.catalogKey, sourceTemplate.catalogKey),
      eq(designTemplates.state, "active"),
    ))
    .limit(1);
  if (!currentTemplate) throw new ProfileDocumentReuseError("SOURCE_TEMPLATE_NOT_FOUND");

  const fields = await database
    .select()
    .from(designSmartFields)
    .where(eq(designSmartFields.projectId, source.id))
    .orderBy(desc(designSmartFields.updatedAt));
  const priorCatalogField = fields.find((field) => field.fieldKey === "current_offer_catalog");
  const previousSnapshot = parseCatalogSnapshot(priorCatalogField?.valueSnapshot);

  const offers = await loadCurrentOfferCatalog(database);
  const currentSnapshot = {
    selectedPackageCode: previousSnapshot?.selectedPackageCode ?? null,
    packages: Object.fromEntries(Object.values(offers.packages).map((offer) => [
      offer.code,
      {
        name: offer.name,
        priceCents: offer.priceCents,
        attractionCount: offer.attractionCount,
        marketingFootprint: offer.marketingFootprint,
      },
    ])),
    addOns: offers.addOns,
    documentYear: input.documentYear,
  };

  let content = clearReconfirmationContent(source.content, fields);
  content = refreshOfferFacts(content, previousSnapshot, currentSnapshot);
  if (source.documentYear) {
    content = content.replaceAll(String(source.documentYear), String(input.documentYear));
  }

  const project = await database.transaction(async (tx) => {
    const [created] = await tx
      .insert(designProjects)
      .values({
        officeAccountId: input.accountId,
        name: `${currentTemplate.name} | ${input.documentYear}`,
        type: currentTemplate.type,
        content,
        notes: source.notes,
        canvas: source.canvas,
        linkedOrganizationId: source.linkedOrganizationId,
        linkedContactId: source.linkedContactId,
        linkedBookingId: null,
        sourceTemplateId: currentTemplate.id,
        sourceCatalogRevision: currentTemplate.catalogRevision,
        documentYear: input.documentYear,
      })
      .returning();
    if (!created) throw new Error("DESIGN_PROJECT_NOT_CREATED");

    await tx.insert(designProjectVersions).values({
      projectId: created.id,
      versionNumber: "v1",
      content: created.content,
      notes: created.notes,
      canvas: created.canvas,
      status: "draft",
      createdByAccountId: input.accountId,
    });
    await tx.insert(designSmartFields).values({
      projectId: created.id,
      fieldKey: "current_offer_catalog",
      sourceType: "package",
      valueSnapshot: JSON.stringify(currentSnapshot),
      state: "current",
    });
    return created;
  });

  await recordAuditEntry(database, {
    entityType: "design_project",
    entityId: project.id,
    action: "reused_for_new_year",
    before: { sourceProjectId: source.id, sourceDocumentYear: source.documentYear },
    after: { documentYear: input.documentYear, sourceTemplateId: currentTemplate.id },
  });
  return project;
}
