import { reconcileCapacityFacts } from "@/features/outreach-planner/outreach-commitments";
import { and, eq } from "drizzle-orm";
import type { db as applicationDatabase } from "@/db/client";
import {
  activities,
  bookings,
  callSessions,
  contacts,
  eventFamilyMembers,
  followUps,
  organizationContacts,
  organizationLocations,
  organizations,
} from "@/db/schema";
import { OrganizationConflictError } from "@/features/organizations/organization-conflict";
import { lockOrganizationMutationDomain } from "@/features/organizations/organization-family-lock";

type Database = typeof applicationDatabase;

export type AddProfileAsLocationInput = {
  canonicalOrgId: string;
  sourceOrgId: string;
  label?: string | null;
};

function locationLabel(source: { name: string; city: string | null; region: string | null }) {
  return [source.city, source.region].filter(Boolean).join(", ") || source.name;
}

/**
 * Add one existing profile to an organization as an internal location.
 * The source profile becomes a retired redirect, while its CRM history is
 * reassigned to the new location so source attribution is preserved.
 */
export async function addProfileAsLocation(
  database: Database,
  input: AddProfileAsLocationInput,
  now: Date,
): Promise<{ locationId: string }> {
  if (input.canonicalOrgId === input.sourceOrgId) {
    throw new OrganizationConflictError("A profile cannot be added to itself.");
  }

  return reconcileCapacityFacts(database, "canonical-merge",async (tx) => {
    await lockOrganizationMutationDomain(tx);

    const [canonical] = await tx
      .select()
      .from(organizations)
      .where(eq(organizations.id, input.canonicalOrgId))
      .for("update");
    if (!canonical) throw new OrganizationConflictError("Organization profile not found.");
    if (canonical.consolidatedIntoId) {
      throw new OrganizationConflictError("This organization profile is retired and cannot accept profiles.");
    }

    const [source] = await tx
      .select()
      .from(organizations)
      .where(eq(organizations.id, input.sourceOrgId))
      .for("update");
    if (!source) throw new OrganizationConflictError("Profile to add was not found.");

    if (source.consolidatedIntoId) {
      if (source.consolidatedIntoId === canonical.id) {
        const [existing] = await tx
          .select({ id: organizationLocations.id })
          .from(organizationLocations)
          .where(and(
            eq(organizationLocations.organizationId, canonical.id),
            eq(organizationLocations.consolidationSourceOrgId, source.id),
          ))
          .limit(1);
        if (existing) return { locationId: existing.id };
      }
      throw new OrganizationConflictError("That profile has already been added to another organization.");
    }

    const [familyMembership] = await tx
      .select({ familyId: eventFamilyMembers.familyId })
      .from(eventFamilyMembers)
      .where(eq(eventFamilyMembers.organizationId, source.id))
      .limit(1);
    if (familyMembership) {
      throw new OrganizationConflictError(
        "That profile is currently in an event family. Remove it from the event family before adding it to an organization profile.",
      );
    }

    const [location] = await tx
      .insert(organizationLocations)
      .values({
        organizationId: canonical.id,
        label: input.label?.trim() || locationLabel(source),
        venueName: source.name,
        address1: source.address1,
        address2: source.address2,
        city: source.city,
        region: source.region,
        postalCode: source.postalCode,
        website: source.website,
        phone: source.phone,
        normalizedPhone: source.normalizedPhone,
        actRecordId: source.actRecordId,
        actSourceLabel: `Added existing profile: ${source.name}`,
        consolidationSourceOrgId: source.id,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: organizationLocations.id });
    if (!location) throw new Error("Could not create organization location.");

    const locationId = location.id;

    // The contacts table has a composite FK to organization_contacts. Create
    // the canonical association before changing contacts.organization_id.
    const sourceAssociations = await tx
      .select()
      .from(organizationContacts)
      .where(eq(organizationContacts.organizationId, source.id));
    for (const association of sourceAssociations) {
      await tx
        .insert(organizationContacts)
        .values({
          organizationId: canonical.id,
          contactId: association.contactId,
          role: association.role,
          isPrimary: false,
          active: association.active,
          source: association.source,
          createdAt: association.createdAt,
          updatedAt: now,
        })
        .onConflictDoNothing();
    }

    await tx.update(contacts).set({ organizationId: canonical.id, organizationLocationId: locationId, updatedAt: now }).where(eq(contacts.organizationId, source.id));
    await tx.update(bookings).set({ organizationId: canonical.id, organizationLocationId: locationId, updatedAt: now }).where(eq(bookings.organizationId, source.id));
    await tx.update(activities).set({ organizationId: canonical.id, organizationLocationId: locationId, updatedAt: now }).where(eq(activities.organizationId, source.id));
    await tx.update(followUps).set({ organizationId: canonical.id, organizationLocationId: locationId, updatedAt: now }).where(eq(followUps.organizationId, source.id));
    await tx.update(callSessions).set({ organizationId: canonical.id, organizationLocationId: locationId }).where(eq(callSessions.organizationId, source.id));

    await tx.delete(organizationContacts).where(eq(organizationContacts.organizationId, source.id));

    await tx
      .update(organizations)
      .set({ consolidatedIntoId: canonical.id, consolidatedAt: now, updatedAt: now })
      .where(eq(organizations.id, source.id));

    return { locationId };
  });
}
