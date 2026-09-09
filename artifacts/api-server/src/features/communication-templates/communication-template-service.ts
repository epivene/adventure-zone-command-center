import { and, asc, eq, gte, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import * as schema from "@/db/schema";
import {
  bookings,
  contacts,
  organizationContacts,
  organizations,
} from "@/db/schema";
import {
  canUseCommercialOffer,
  type CommercialOfferUseContext,
} from "@/features/commercial-offers/commercial-offer-policy";
import { CommercialOfferRepository } from "@/features/commercial-offers/commercial-offer-repository";
import { DrizzlePackageIntelligenceSettingsRepository } from "@/features/packages/package-intelligence-settings";
import { CommunicationTemplateRepository } from "./communication-template-repository";
import {
  formatPackageDuration,
  formatPackagePrice,
  renderCommunicationTemplateText,
} from "./communication-template-renderer";
import { applyEarlyBirdPromoToRenderedTemplate } from "./communication-template-promotion";
import type {
  RenderedCommunicationTemplate,
  TemplateRenderValues,
} from "./communication-template-types";

type Database = NodePgDatabase<typeof schema>;

function dateLabel(start: Date | null, end: Date | null): string | null {
  if (!start) return null;
  const formatter = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  if (!end || start.toISOString().slice(0, 10) === end.toISOString().slice(0, 10)) {
    return formatter.format(start);
  }
  return `${formatter.format(start)}–${formatter.format(end)}`;
}

export async function renderCommunicationTemplate(
  database: Database,
  input: {
    templateId: string;
    organizationId: string;
    contactId: string;
    packageTemplateId?: string | null;
    commercialOfferId?: string | null;
    commercialOfferContext?: CommercialOfferUseContext | null;
    sender: { name: string; phone: string | null; email: string | null };
    extraValues?: TemplateRenderValues;
    now?: Date;
    alreadyPaid?: boolean;
    existingPromotionDeadlineDate?: string | null;
  },
): Promise<RenderedCommunicationTemplate> {
  const repository = new CommunicationTemplateRepository(database);
  const template = await repository.getById(input.templateId);
  if (!template) throw new Error("TEMPLATE_NOT_FOUND");

  const organizationRows = await database
    .select({
      id: organizations.id,
      name: organizations.name,
      city: organizations.city,
      region: organizations.region,
    })
    .from(organizations)
    .where(
      and(
        eq(organizations.id, input.organizationId),
        sql`${organizations.consolidatedIntoId} is null`,
      ),
    )
    .limit(1);
  const organization = organizationRows[0];
  if (!organization) throw new Error("ORGANIZATION_NOT_FOUND");

  const contactRows = await database
    .select({
      id: contacts.id,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
    })
    .from(organizationContacts)
    .innerJoin(contacts, eq(contacts.id, organizationContacts.contactId))
    .where(
      and(
        eq(organizationContacts.organizationId, input.organizationId),
        eq(organizationContacts.contactId, input.contactId),
        eq(organizationContacts.active, true),
      ),
    )
    .limit(1);
  const contact = contactRows[0];
  if (!contact) throw new Error("CONTACT_NOT_FOUND");

  const upcomingBookings = await database
    .select({ id: bookings.id, startsAt: bookings.startsAt, endsAt: bookings.endsAt })
    .from(bookings)
    .where(
      and(
        eq(bookings.organizationId, input.organizationId),
        gte(bookings.startsAt, input.now ?? new Date()),
      ),
    )
    .orderBy(asc(bookings.startsAt))
    .limit(1);

  let packageRow: Awaited<
    ReturnType<DrizzlePackageIntelligenceSettingsRepository["listPackageTemplates"]>
  >[number] | null = null;
  if (input.packageTemplateId) {
    const packageTemplates = await new DrizzlePackageIntelligenceSettingsRepository(
      database as any,
    ).listPackageTemplates();
    packageRow =
      packageTemplates.find(
        (candidate) =>
          candidate.id === input.packageTemplateId && candidate.active,
      ) ?? null;
    if (!packageRow) throw new Error("PACKAGE_NOT_FOUND");
  }

  if (input.commercialOfferId) {
    if (!input.commercialOfferContext) {
      throw new Error("COMMERCIAL_OFFER_CONTEXT_REQUIRED");
    }
    const offer = await new CommercialOfferRepository(database as any).getById(
      input.commercialOfferId,
    );
    if (!offer) throw new Error("COMMERCIAL_OFFER_NOT_FOUND");
    const use = canUseCommercialOffer(offer, {
      ...input.commercialOfferContext,
      packageCode:
        packageRow?.code ?? input.commercialOfferContext.packageCode ?? null,
    });
    if (!use.allowed) {
      throw new Error(`COMMERCIAL_OFFER_NOT_ALLOWED:${use.reason ?? "Unknown reason"}`);
    }
  }

  const contactName = [contact.firstName, contact.lastName]
    .map((value) => value.trim())
    .filter(Boolean)
    .join(" ");
  const booking = upcomingBookings[0];
  const earlyBirdDeadline = new Intl.DateTimeFormat("en-US", {
    month: "long", day: "numeric", year: "numeric", timeZone: "UTC",
  }).format(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000));
  const values: TemplateRenderValues = {
    contactName,
    eventName: organization.name,
    eventCity: organization.city,
    eventState: organization.region,
    eventDates: booking ? dateLabel(booking.startsAt, booking.endsAt) : null,
    senderName: input.sender.name,
    senderPhone: input.sender.phone,
    senderEmail: input.sender.email,
    earlyBirdDeadline,
    packageName: packageRow?.name ?? null,
    packagePrice: packageRow ? formatPackagePrice(packageRow.basePriceCents) : null,
    packageDuration: packageRow
      ? formatPackageDuration(
          packageRow.baseDurationMinDays,
          packageRow.baseDurationMaxDays,
        )
      : null,
    ...input.extraValues,
  };

  const rendered = renderCommunicationTemplateText({
    templateId: template.id,
    subjectTemplate: template.subjectTemplate,
    bodyTemplate: template.bodyTemplate,
    bodyFormat: template.bodyFormat,
    requiredPlaceholders: template.requiredPlaceholders,
    values,
  });
  const now = input.now ?? new Date();
  return applyEarlyBirdPromoToRenderedTemplate(rendered, {
    category: template.category,
    code: template.code,
    now,
    alreadyPaid: input.alreadyPaid ?? false,
    existingPromotionDeadlineDate: input.existingPromotionDeadlineDate,
    bookingId: booking?.id ?? null,
    eventYear: booking?.startsAt?.getUTCFullYear() ?? 2027,
  });
}


