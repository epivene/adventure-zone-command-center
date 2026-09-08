import { and, asc, desc, eq, isNull } from "drizzle-orm";

import type { db as database } from "@/db/client";
import {
  bookingPackageSelections,
  bookings,
  contacts,
  contactPhones,
  contractSettings,
  organizationContacts,
  organizations,
  packageTemplates,
  travelLegs,
} from "@/db/schema";

import type { ContractAutofillSource } from "./contract-autofill";

type Database = typeof database;
type Contact = NonNullable<ContractAutofillSource["bookingPrimaryContact"]>;

export class DrizzleContractSourceRepository {
  constructor(private readonly database: Database) {}

  private async contact(contactId: string | null): Promise<Contact | null> {
    if (!contactId) return null;
    const [record] = await this.database.select({
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      jobTitle: contacts.jobTitle,
      email: contacts.email,
      legacyPhone: contacts.phone,
    }).from(contacts).where(eq(contacts.id, contactId)).limit(1);
    if (!record) return null;
    const [phone] = await this.database.select({ number: contactPhones.number })
      .from(contactPhones)
      .where(and(eq(contactPhones.contactId, contactId), isNull(contactPhones.doNotCallAt)))
      .orderBy(desc(contactPhones.primary), asc(contactPhones.id))
      .limit(1);
    return { ...record, phone: phone?.number ?? record.legacyPhone };
  }

  private async organizationPrimary(organizationId: string | null): Promise<Contact | null> {
    if (!organizationId) return null;
    const [membership] = await this.database.select({ contactId: organizationContacts.contactId })
      .from(organizationContacts)
      .where(and(
        eq(organizationContacts.organizationId, organizationId),
        eq(organizationContacts.isPrimary, true),
        eq(organizationContacts.active, true),
      ))
      .limit(1);
    return this.contact(membership?.contactId ?? null);
  }

  async load(bookingId: string): Promise<ContractAutofillSource | null> {
    const [record] = await this.database.select({
      booking: {
        id: bookings.id,
        organizationId: bookings.organizationId,
        primaryContactId: bookings.primaryContactId,
        name: bookings.name,
        venueName: bookings.venueName,
        address1: bookings.address1,
        city: bookings.city,
        region: bookings.region,
        postalCode: bookings.postalCode,
        startsAt: bookings.startsAt,
        endsAt: bookings.endsAt,
        physicalAttractionTotal: bookings.physicalAttractionTotal,
      },
      organization: { id: organizations.id, name: organizations.name },
      travelLeg: { name: travelLegs.name },
    }).from(bookings)
      .leftJoin(organizations, eq(bookings.organizationId, organizations.id))
      .leftJoin(travelLegs, eq(bookings.travelLegId, travelLegs.id))
      .where(eq(bookings.id, bookingId))
      .limit(1);
    if (!record) return null;

    const [bookingPrimaryContact, organizationPrimaryContact, packages, settingsRows] = await Promise.all([
      this.contact(record.booking.primaryContactId),
      this.organizationPrimary(record.booking.organizationId),
      this.database.select({ id: packageTemplates.id, name: packageTemplates.name })
        .from(bookingPackageSelections)
        .innerJoin(packageTemplates, eq(bookingPackageSelections.packageTemplateId, packageTemplates.id))
        .where(eq(bookingPackageSelections.bookingId, bookingId))
        .orderBy(asc(packageTemplates.name), asc(packageTemplates.id)),
      this.database.select({
        internalSignerName: contractSettings.internalSignerName,
        internalSignerEmail: contractSettings.internalSignerEmail,
        internalSignerOrder: contractSettings.internalSignerOrder,
        insuranceRecipientName: contractSettings.insuranceRecipientName,
        insuranceRecipientEmail: contractSettings.insuranceRecipientEmail,
      }).from(contractSettings).where(eq(contractSettings.key, "default")).limit(1),
    ]);
    const settings = settingsRows[0];
    if (!settings) throw new Error("CONTRACT_SETTINGS_MISSING");

    return {
      booking: {
        id: record.booking.id,
        organizationId: record.booking.organizationId,
        name: record.booking.name,
        venueName: record.booking.venueName,
        address1: record.booking.address1,
        city: record.booking.city,
        region: record.booking.region,
        postalCode: record.booking.postalCode,
        startsAt: record.booking.startsAt,
        endsAt: record.booking.endsAt,
        physicalAttractionTotal: record.booking.physicalAttractionTotal,
      },
      organization: record.organization?.id && record.organization.name
        ? { id: record.organization.id, name: record.organization.name }
        : null,
      bookingPrimaryContact,
      organizationPrimaryContact,
      packages,
      travelLeg: record.travelLeg?.name ? { name: record.travelLeg.name } : null,
      settings,
    };
  }
}
