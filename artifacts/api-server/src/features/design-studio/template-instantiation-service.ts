import { and, eq } from "drizzle-orm";

import type { db as database } from "@/db/client";
import { recordAuditEntry } from "@/features/audit/audit-service";
import {
  designProjectVersions,
  designProjects,
  designSmartFields,
  designTemplates,
} from "@workspace/db/design-studio-schema";
import { bookings, contacts, organizations } from "@workspace/db";
import {
  loadCurrentOfferCatalog,
  type CurrentOfferCatalog,
  type CurrentPackageCode,
} from "@/features/packages/current-offer-catalog";

export type InstantiateTemplateInput = {
  accountId: string;
  templateId: string;
  organizationId?: string | null;
  contactId?: string | null;
  bookingId?: string | null;
  documentYear: number;
};

const PACKAGE_BY_CATALOG_KEY: Record<string, CurrentPackageCode> = {
  "email.adventure_zone_focus": "adventure_zone",
  "email.warriors_focus": "weekend_warriors",
  "email.pirates_focus": "pirates_rebellion",
  "email.mini_zone_focus": "mini_zone",
};

function money(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function packageCodeFrom(template: typeof designTemplates.$inferSelect): CurrentPackageCode | null {
  const locked = template.lockedContent as Record<string, unknown> | null;
  const explicit = locked?.packageCode;
  if (typeof explicit === "string" && explicit !== "multi_package") {
    return explicit as CurrentPackageCode;
  }
  return template.catalogKey ? PACKAGE_BY_CATALOG_KEY[template.catalogKey] ?? null : null;
}

function replaceAll(content: string, values: Record<string, string>): string {
  let rendered = content;
  for (const [key, value] of Object.entries(values)) {
    rendered = rendered.replaceAll(`{{${key}}}`, value);
  }
  return rendered;
}

export function resolveTemplateContent(input: {
  content: string;
  template: typeof designTemplates.$inferSelect;
  catalog: CurrentOfferCatalog;
  documentYear: number;
}): { content: string; snapshot: Record<string, unknown> } {
  const selectedCode = packageCodeFrom(input.template);
  const selected = selectedCode ? input.catalog.packages[selectedCode] : null;
  const offers = Object.values(input.catalog.packages);
  const packageSummaryHtml = offers
    .map((offer) => `<strong>${offer.name}</strong>: ${money(offer.priceCents)} | ${offer.attractionCount} attractions`)
    .join("<br>");

  const values: Record<string, string> = {
    event_year: String(input.documentYear),
    package_name: selected?.name ?? "{{package_name}}",
    package_price: selected ? money(selected.priceCents) : "{{package_price}}",
    package_attraction_count: selected ? String(selected.attractionCount) : "{{package_attraction_count}}",
    package_marketing_footprint: selected?.marketingFootprint ?? "{{package_marketing_footprint}}",
    package_customer_description: selected?.customerDescription ?? "{{package_customer_description}}",
    package_summary_html: packageSummaryHtml,
    adventure_zone_price: money(input.catalog.packages.adventure_zone.priceCents),
    warriors_price: money(input.catalog.packages.weekend_warriors.priceCents),
    pirates_price: money(input.catalog.packages.pirates_rebellion.priceCents),
    mini_zone_price: money(input.catalog.packages.mini_zone.priceCents),
    foam_party_price: money(input.catalog.addOns.foamParty.priceCents),
  };

  return {
    content: replaceAll(input.content, values),
    snapshot: {
      selectedPackageCode: selectedCode,
      packages: Object.fromEntries(
        offers.map((offer) => [offer.code, {
          name: offer.name,
          priceCents: offer.priceCents,
          attractionCount: offer.attractionCount,
          marketingFootprint: offer.marketingFootprint,
        }]),
      ),
      addOns: input.catalog.addOns,
      documentYear: input.documentYear,
    },
  };
}

export class TemplateInstantiationError extends Error {
  constructor(
    public readonly code:
      | "TEMPLATE_NOT_FOUND"
      | "TEMPLATE_ARCHIVED"
      | "ORGANIZATION_NOT_FOUND"
      | "CONTACT_ORGANIZATION_MISMATCH"
      | "BOOKING_ORGANIZATION_MISMATCH",
  ) {
    super(code);
    this.name = "TemplateInstantiationError";
  }
}

export async function instantiateTemplate(
  database: typeof database,
  input: InstantiateTemplateInput,
) {
  const [template] = await database
    .select()
    .from(designTemplates)
    .where(eq(designTemplates.id, input.templateId))
    .limit(1);
  if (!template) throw new TemplateInstantiationError("TEMPLATE_NOT_FOUND");
  if (template.state !== "active") throw new TemplateInstantiationError("TEMPLATE_ARCHIVED");

  if (input.contactId && !input.organizationId) {
    throw new TemplateInstantiationError("CONTACT_ORGANIZATION_MISMATCH");
  }
  if (input.bookingId && !input.organizationId) {
    throw new TemplateInstantiationError("BOOKING_ORGANIZATION_MISMATCH");
  }

  if (input.organizationId) {
    const [organization] = await database
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.id, input.organizationId))
      .limit(1);
    if (!organization) throw new TemplateInstantiationError("ORGANIZATION_NOT_FOUND");
  }

  if (input.contactId && input.organizationId) {
    const [contact] = await database
      .select({ id: contacts.id })
      .from(contacts)
      .where(and(
        eq(contacts.id, input.contactId),
        eq(contacts.organizationId, input.organizationId),
      ))
      .limit(1);
    if (!contact) throw new TemplateInstantiationError("CONTACT_ORGANIZATION_MISMATCH");
  }

  if (input.bookingId && input.organizationId) {
    const [booking] = await database
      .select({ id: bookings.id })
      .from(bookings)
      .where(and(
        eq(bookings.id, input.bookingId),
        eq(bookings.organizationId, input.organizationId),
      ))
      .limit(1);
    if (!booking) throw new TemplateInstantiationError("BOOKING_ORGANIZATION_MISMATCH");
  }

  const catalog = await loadCurrentOfferCatalog(database);
  const resolved = resolveTemplateContent({
    content: template.content,
    template,
    catalog,
    documentYear: input.documentYear,
  });

  const project = await database.transaction(async (tx) => {
    const [created] = await tx
      .insert(designProjects)
      .values({
        officeAccountId: input.accountId,
        name: `${template.name} | ${input.documentYear}`,
        type: template.type,
        content: resolved.content,
        linkedOrganizationId: input.organizationId ?? null,
        linkedContactId: input.contactId ?? null,
        linkedBookingId: input.bookingId ?? null,
        sourceTemplateId: template.id,
        sourceCatalogRevision: template.catalogRevision,
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
      valueSnapshot: JSON.stringify(resolved.snapshot),
      state: "current",
    });

    return created;
  });

  await recordAuditEntry(database, {
    entityType: "design_project",
    entityId: project.id,
    action: "created_from_catalog",
    before: null,
    after: {
      sourceTemplateId: template.id,
      sourceCatalogRevision: template.catalogRevision,
      linkedOrganizationId: input.organizationId ?? null,
      documentYear: input.documentYear,
    },
  });

  return project;
}
