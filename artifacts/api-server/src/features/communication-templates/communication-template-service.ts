import { and, asc, eq, gte, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import * as schema from "@/db/schema";
import { bookings, contacts, organizations } from "@/db/schema";
import { CommunicationTemplateRepository } from "./communication-template-repository";
import {
  formatPackageDuration,
  formatPackagePrice,
  renderCommunicationTemplateText,
} from "./communication-template-renderer";
import type {
  RenderedCommunicationTemplate,
  TemplateRenderValues,
} from "./communication-template-types";

type Database = NodePgDatabase<typeof schema>;

type PackageRow = {
  id: string;
  name: string;
  base_price_cents: number | null;
  base_duration_min_days: number | null;
  base_duration_max_days: number | null;
};

function rowsOf<T>(result: unknown): T[] {
  if (result && typeof result === "object" && "rows" in result) {
    return ((result as { rows?: T[] }).rows ?? []);
  }
  return Array.isArray(result) ? (result as T[]) : [];
}

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
    sender: { name: string; phone: string | null; email: string | null };
    extraValues?: TemplateRenderValues;
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
      organizationId: contacts.organizationId,
    })
    .from(contacts)
    .where(
      and(
        eq(contacts.id, input.contactId),
        eq(contacts.organizationId, input.organizationId),
      ),
    )
    .limit(1);
  const contact = contactRows[0];
  if (!contact) throw new Error("CONTACT_NOT_FOUND");

  const upcomingBookings = await database
    .select({ startsAt: bookings.startsAt, endsAt: bookings.endsAt })
    .from(bookings)
    .where(
      and(
        eq(bookings.organizationId, input.organizationId),
        gte(bookings.startsAt, new Date()),
      ),
    )
    .orderBy(asc(bookings.startsAt))
    .limit(1);

  let packageRow: PackageRow | null = null;
  if (input.packageTemplateId) {
    const result = await database.execute(sql`
      select id, name, base_price_cents, base_duration_min_days, base_duration_max_days
      from package_templates
      where id = ${input.packageTemplateId}::uuid and active = true
      limit 1
    `);
    packageRow = rowsOf<PackageRow>(result)[0] ?? null;
    if (!packageRow) throw new Error("PACKAGE_NOT_FOUND");
  }

  const contactName = [contact.firstName, contact.lastName]
    .map((value) => value.trim())
    .filter(Boolean)
    .join(" ");
  const booking = upcomingBookings[0];
  const values: TemplateRenderValues = {
    contactName,
    eventName: organization.name,
    eventCity: organization.city,
    eventState: organization.region,
    eventDates: booking ? dateLabel(booking.startsAt, booking.endsAt) : null,
    senderName: input.sender.name,
    senderPhone: input.sender.phone,
    senderEmail: input.sender.email,
    packageName: packageRow?.name ?? null,
    packagePrice: packageRow ? formatPackagePrice(packageRow.base_price_cents) : null,
    packageDuration: packageRow
      ? formatPackageDuration(
          packageRow.base_duration_min_days,
          packageRow.base_duration_max_days,
        )
      : null,
    ...input.extraValues,
  };

  return renderCommunicationTemplateText({
    templateId: template.id,
    subjectTemplate: template.subjectTemplate,
    bodyTemplate: template.bodyTemplate,
    requiredPlaceholders: template.requiredPlaceholders,
    values,
  });
}
