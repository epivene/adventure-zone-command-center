import { reconcileCapacityFacts } from "@/features/outreach-planner/outreach-commitments";
/**
 * Organization consolidation -- merges multiple organization profiles that
 * represent locations of the same real-world organization into one canonical
 * profile with internal organization_locations records.
 *
 * Unlike a plain merge, contacts/bookings/activities/follow-ups remain grouped
 * by their original source profile (location) via organizationLocationId.
 */

import { and, count, eq, inArray, isNull, sql } from "drizzle-orm";
import type { db as applicationDatabase } from "@/db/client";
import {
  activities,
  bookings,
  callSessions,
  contacts,
  followUps,
  organizationContacts,
  organizationFamilyReviews,
  organizationLocations,
  organizations,
} from "@/db/schema";
import { recordAuditEntry } from "@/features/audit/audit-service";
import { OrganizationConflictError } from "@/features/organizations/organization-conflict";
import { inferLocationTravelLegId } from "@/features/organization-locations/location-repository";
import { lockOrganizationMutationDomain } from "@/features/organizations/organization-family-lock";

type ConsolidationDatabase = typeof applicationDatabase;
type ConsolidationTransaction = Parameters<
  Parameters<ConsolidationDatabase["transaction"]>[0]
>[0];

//  Preview

export type ConsolidationPreviewInput = {
  /** ID of the existing org that should become the canonical profile. Null if creating new. */
  canonicalOrgId: string | null;
  /** Used only when canonicalOrgId is null: proposed canonical organization name. */
  proposedCanonicalName?: string | null;
  /** Source org IDs to consolidate (2 20). */
  sourceOrgIds: string[];
};

export type LocationProposal = {
  sourceOrgId: string;
  sourceOrgName: string;
  proposedLabel: string;
  city: string | null;
  region: string | null;
  /** True when this org is already consolidated into the canonical (repeat-safe). */
  alreadyConsolidated: boolean;
  recordCounts: {
    contacts: number;
    bookings: number;
    activities: number;
    followUps: number;
  };
};

export type ConsolidationPreview = {
  canonical: { id: string | null; name: string };
  locationProposals: LocationProposal[];
  generalHistoryCounts: LocationProposal["recordCounts"];
};

export async function buildConsolidationPreview(
  database: ConsolidationDatabase,
  input: ConsolidationPreviewInput,
): Promise<ConsolidationPreview> {
  if (input.sourceOrgIds.length < 2) {
    throw new Error("Select at least 2 source organizations to consolidate.");
  }
  if (input.sourceOrgIds.length > 20) {
    throw new Error("Cannot consolidate more than 20 source organizations at once.");
  }

  const sourceIds = [...new Set(input.sourceOrgIds)];

  // Load canonical org if provided
  let canonical: { id: string | null; name: string } = {
    id: null,
    name: input.proposedCanonicalName?.trim() || "New Organization",
  };
  if (input.canonicalOrgId) {
    const [org] = await database
      .select({ id: organizations.id, name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, input.canonicalOrgId))
      .limit(1);
    if (!org) throw new Error("Canonical organization not found.");
    canonical = { id: org.id, name: org.name };
  }

  // Load source org details
  const sourceOrgs = await database
    .select({
      id: organizations.id,
      name: organizations.name,
      city: organizations.city,
      region: organizations.region,
      consolidatedIntoId: organizations.consolidatedIntoId,
    })
    .from(organizations)
    .where(inArray(organizations.id, sourceIds));

  const sourceOrgMap = new Map(sourceOrgs.map((o) => [o.id, o]));

  // Count records per source org
  const [contactCounts, bookingCounts, activityCounts, followUpCounts] = await Promise.all([
    database
      .select({ organizationId: contacts.organizationId, value: count() })
      .from(contacts)
      .where(inArray(contacts.organizationId, sourceIds))
      .groupBy(contacts.organizationId),
    database
      .select({ organizationId: bookings.organizationId, value: count() })
      .from(bookings)
      .where(inArray(bookings.organizationId, sourceIds))
      .groupBy(bookings.organizationId),
    database
      .select({ organizationId: activities.organizationId, value: count() })
      .from(activities)
      .where(inArray(activities.organizationId, sourceIds))
      .groupBy(activities.organizationId),
    database
      .select({ organizationId: followUps.organizationId, value: count() })
      .from(followUps)
      .where(inArray(followUps.organizationId, sourceIds))
      .groupBy(followUps.organizationId),
  ]);

  const contactCountMap = new Map(contactCounts.map((r) => [r.organizationId, Number(r.value)]));
  const bookingCountMap = new Map(bookingCounts.map((r) => [r.organizationId, Number(r.value)]));
  const activityCountMap = new Map(activityCounts.map((r) => [r.organizationId, Number(r.value)]));
  const followUpCountMap = new Map(followUpCounts.map((r) => [r.organizationId, Number(r.value)]));

  const locationProposals: LocationProposal[] = sourceIds.map((sourceId) => {
    const org = sourceOrgMap.get(sourceId);
    if (!org) throw new Error(`Source organization ${sourceId} not found.`);

    const label = deriveLocationLabel(org);
    const alreadyConsolidated =
      !!org.consolidatedIntoId &&
      (input.canonicalOrgId ? org.consolidatedIntoId === input.canonicalOrgId : false);

    return {
      sourceOrgId: org.id,
      sourceOrgName: org.name,
      proposedLabel: label,
      city: org.city,
      region: org.region,
      alreadyConsolidated,
      recordCounts: {
        contacts: contactCountMap.get(org.id) ?? 0,
        bookings: bookingCountMap.get(org.id) ?? 0,
        activities: activityCountMap.get(org.id) ?? 0,
        followUps: followUpCountMap.get(org.id) ?? 0,
      },
    };
  });

  let generalHistoryCounts: LocationProposal["recordCounts"] = {
    contacts: 0,
    bookings: 0,
    activities: 0,
    followUps: 0,
  };
  if (canonical.id) {
    const [[contactCount], [bookingCount], [activityCount], [followUpCount]] = await Promise.all([
      database.select({ value: count() }).from(contacts).where(eq(contacts.organizationId, canonical.id)),
      database.select({ value: count() }).from(bookings).where(eq(bookings.organizationId, canonical.id)),
      database.select({ value: count() }).from(activities).where(eq(activities.organizationId, canonical.id)),
      database.select({ value: count() }).from(followUps).where(eq(followUps.organizationId, canonical.id)),
    ]);
    generalHistoryCounts = {
      contacts: Number(contactCount?.value ?? 0),
      bookings: Number(bookingCount?.value ?? 0),
      activities: Number(activityCount?.value ?? 0),
      followUps: Number(followUpCount?.value ?? 0),
    };
  }

  return { canonical, locationProposals, generalHistoryCounts };
}

//  Apply

export type LocationAssignment = {
  sourceOrgId: string;
  /** Final label for the location (user-confirmed). */
  label: string;
};

export type ConsolidationApplyInput = {
  /** Existing org to use as canonical, or null to create one. */
  canonicalOrgId: string | null;
  /** Required when canonicalOrgId is null. */
  proposedCanonical?: {
    name: string;
    website?: string | null;
    phone?: string | null;
  };
  /**
   * One entry per source org. Each sourceOrgId must be unique within the
   * array -- duplicates are rejected at validation time.
   */
  locationAssignments: LocationAssignment[];
};

export type ConsolidationApplyResult = {
  canonicalOrgId: string;
  /** Maps sourceOrgId → created (or reused) locationId */
  locationIdBySourceOrgId: Record<string, string>;
};

export async function applyConsolidation(
  database: ConsolidationDatabase,
  input: ConsolidationApplyInput,
  now: Date,
): Promise<ConsolidationApplyResult> {
  if (input.locationAssignments.length < 2) {
    throw new Error("Consolidation requires at least 2 source organizations.");
  }
  if (input.locationAssignments.length > 20) {
    throw new Error("Cannot consolidate more than 20 source organizations at once.");
  }
  if (!input.canonicalOrgId && !input.proposedCanonical?.name?.trim()) {
    throw new Error("A canonical organization name is required when not reusing an existing one.");
  }

  // Guard: each sourceOrgId must appear exactly once.
  const seenSourceIds = new Set<string>();
  for (const a of input.locationAssignments) {
    if (seenSourceIds.has(a.sourceOrgId)) {
      throw new Error(`Duplicate sourceOrgId in locationAssignments: ${a.sourceOrgId}`);
    }
    seenSourceIds.add(a.sourceOrgId);
  }

  return reconcileCapacityFacts(database, "canonical-merge",async (tx) => {
    await lockOrganizationMutationDomain(tx);

    const sourceIds = input.locationAssignments.map((a) => a.sourceOrgId);

    // Lock all involved organizations in deterministic order.
    const allOrgIds = input.canonicalOrgId
      ? [...new Set([input.canonicalOrgId, ...sourceIds])].sort()
      : [...new Set(sourceIds)].sort();

    const lockedOrgs = await tx
      .select()
      .from(organizations)
      .where(inArray(organizations.id, allOrgIds))
      .orderBy(organizations.id)
      .for("update");

    const orgById = new Map(lockedOrgs.map((o) => [o.id, o]));

    // Validate sources exist
    for (const sourceId of sourceIds) {
      if (!orgById.has(sourceId)) {
        throw new OrganizationConflictError(`Source organization ${sourceId} no longer exists.`);
      }
    }

    // Resolve or create canonical org
    let canonicalOrgId: string;
    if (input.canonicalOrgId) {
      const canonical = orgById.get(input.canonicalOrgId);
      if (!canonical) {
        throw new OrganizationConflictError("Canonical organization no longer exists.");
      }
      // Canonical org must not itself be consolidated
      if (canonical.consolidatedIntoId) {
        throw new OrganizationConflictError(
          `${canonical.name} is already consolidated into another organization and cannot be used as the canonical profile.`,
        );
      }
      canonicalOrgId = canonical.id;
    } else {
      const proposed = input.proposedCanonical!;
      const [created] = await tx
        .insert(organizations)
        .values({
          name: proposed.name.trim(),
          website: proposed.website?.trim() || null,
          phone: proposed.phone?.trim() || null,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: organizations.id });
      if (!created) throw new Error("Could not create canonical organization.");
      canonicalOrgId = created.id;

      await recordAuditEntry(tx, {
        entityType: "organization",
        entityId: canonicalOrgId,
        action: "organization_consolidation_canonical_created",
        before: null,
        after: { name: proposed.name.trim(), sourceOrgIds: sourceIds },
      });
    }

    // Make sure canonical is not in the source list
    if (sourceIds.includes(canonicalOrgId)) {
      throw new OrganizationConflictError(
        "The canonical organization cannot also be a source organization.",
      );
    }

    const locationIdBySourceOrgId: Record<string, string> = {};

    for (const assignment of input.locationAssignments) {
      const sourceOrg = orgById.get(assignment.sourceOrgId);
      if (!sourceOrg) continue;

      // Repeat-safe: if already consolidated into this canonical, find the existing location
      // by the durable sourceOrgId link rather than by label matching.
      if (sourceOrg.consolidatedIntoId === canonicalOrgId) {
        const [existingLoc] = await tx
          .select({ id: organizationLocations.id })
          .from(organizationLocations)
          .where(
            and(
              eq(organizationLocations.organizationId, canonicalOrgId),
              eq(organizationLocations.consolidationSourceOrgId, sourceOrg.id),
            ),
          )
          .limit(1);
        locationIdBySourceOrgId[assignment.sourceOrgId] = existingLoc?.id ?? "(already-consolidated)";
        continue;
      }

      // If this source is already consolidated into a DIFFERENT org, reject.
      if (sourceOrg.consolidatedIntoId && sourceOrg.consolidatedIntoId !== canonicalOrgId) {
        throw new OrganizationConflictError(
          `${sourceOrg.name} is already consolidated into a different organization.`,
        );
      }

      // Create the organizationLocations record for this source.
      const label = assignment.label.trim();
      const representedLegs = await tx
        .select({ travelLegId: bookings.travelLegId })
        .from(bookings)
        .where(and(
          eq(bookings.organizationId, sourceOrg.id),
          sql`${bookings.travelLegId} is not null`,
        ))
        .groupBy(bookings.travelLegId);
      const [newLoc] = await tx
        .insert(organizationLocations)
        .values({
          organizationId: canonicalOrgId,
          label,
          venueName: sourceOrg.name,
          address1: sourceOrg.address1,
          address2: sourceOrg.address2,
          city: sourceOrg.city,
          region: sourceOrg.region,
          postalCode: sourceOrg.postalCode,
          website: sourceOrg.website,
          phone: sourceOrg.phone,
          normalizedPhone: sourceOrg.normalizedPhone,
          actRecordId: sourceOrg.actRecordId,
          actSourceLabel: `Retired organization profile: ${sourceOrg.name}`,
          travelLegId: inferLocationTravelLegId(
            representedLegs.map((record) => record.travelLegId),
          ),
          consolidationSourceOrgId: sourceOrg.id,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: organizationLocations.id });
      if (!newLoc) throw new Error(`Could not create location for ${sourceOrg.name}.`);
      const locationId = newLoc.id;
      locationIdBySourceOrgId[assignment.sourceOrgId] = locationId;

      await moveRecordsToLocation(tx, {
        sourceOrgId: assignment.sourceOrgId,
        canonicalOrgId,
        locationId,
        now,
      });

      // Mark source org as consolidated.
      await tx
        .update(organizations)
        .set({
          consolidatedIntoId: canonicalOrgId,
          consolidatedAt: now,
          updatedAt: now,
        })
        .where(eq(organizations.id, assignment.sourceOrgId));

      await recordAuditEntry(tx, {
        entityType: "organization",
        entityId: assignment.sourceOrgId,
        action: "organization_consolidated",
        before: { consolidatedIntoId: null },
        after: { consolidatedIntoId: canonicalOrgId, locationId, label },
      });
    }

    // Clean up any stale family review records that involve the retired source orgs.
    const retiredIds = input.locationAssignments.map((a) => a.sourceOrgId);
    const staleReviews = await tx
      .select({
        groupKey: organizationFamilyReviews.groupKey,
        candidateIds: organizationFamilyReviews.candidateIds,
      })
      .from(organizationFamilyReviews);

    const staleKeys = staleReviews
      .filter((r) => r.candidateIds.some((id) => retiredIds.includes(id)))
      .map((r) => r.groupKey);

    if (staleKeys.length) {
      await tx
        .delete(organizationFamilyReviews)
        .where(inArray(organizationFamilyReviews.groupKey, staleKeys));
    }

    return { canonicalOrgId, locationIdBySourceOrgId };
  }, { isolationLevel: "read committed" });
}

//  Internal helpers

/** Move all records owned by sourceOrg to canonicalOrg under the given location. */
async function moveRecordsToLocation(
  tx: ConsolidationTransaction,
  opts: {
    sourceOrgId: string;
    canonicalOrgId: string;
    locationId: string;
    now: Date;
  },
): Promise<void> {
  const { sourceOrgId, canonicalOrgId, locationId, now } = opts;

  //  1. Move contacts
  // The FK constraint contacts_primary_organization_contact_fk requires:
  //   contacts(organization_id, id) → organization_contacts(organization_id, contact_id)
  // So we must create organizationContacts rows for canonical BEFORE updating contacts.

  // Get contacts owned by source org
  const sourceContacts = await tx
    .select({ id: contacts.id })
    .from(contacts)
    .where(eq(contacts.organizationId, sourceOrgId));
  const sourceContactIds = sourceContacts.map((c) => c.id);

  if (sourceContactIds.length) {
    // Get existing org-contact associations from source
    const sourceAssociations = await tx
      .select({
        contactId: organizationContacts.contactId,
        role: organizationContacts.role,
        active: organizationContacts.active,
        source: organizationContacts.source,
      })
      .from(organizationContacts)
      .where(
        and(
          eq(organizationContacts.organizationId, sourceOrgId),
          inArray(organizationContacts.contactId, sourceContactIds),
        ),
      );

    if (sourceAssociations.length) {
      // Upsert associations for canonical org (isPrimary=false to avoid conflicts)
      await tx
        .insert(organizationContacts)
        .values(
          sourceAssociations.map((a) => ({
            organizationId: canonicalOrgId,
            contactId: a.contactId,
            role: a.role,
            isPrimary: false,
            active: a.active,
            source: a.source,
            createdAt: now,
            updatedAt: now,
          })),
        )
        .onConflictDoNothing({ target: [organizationContacts.organizationId, organizationContacts.contactId] });
    }

    // Now update contacts to point to canonical org + new location
    await tx
      .update(contacts)
      .set({
        organizationId: canonicalOrgId,
        organizationLocationId: locationId,
        updatedAt: now,
      })
      .where(eq(contacts.organizationId, sourceOrgId));

    // Remove the old source associations (now that contacts.organizationId is updated)
    if (sourceAssociations.length) {
      await tx
        .delete(organizationContacts)
        .where(
          and(
            eq(organizationContacts.organizationId, sourceOrgId),
            inArray(
              organizationContacts.contactId,
              sourceAssociations.map((a) => a.contactId),
            ),
          ),
        );
    }
  }

  //  2. Move bookings
  await tx
    .update(bookings)
    .set({
      organizationId: canonicalOrgId,
      organizationLocationId: locationId,
      updatedAt: now,
    })
    .where(eq(bookings.organizationId, sourceOrgId));

  //  3. Move activities
  await tx
    .update(activities)
    .set({
      organizationId: canonicalOrgId,
      organizationLocationId: locationId,
      updatedAt: now,
    })
    .where(eq(activities.organizationId, sourceOrgId));

  //  4. Move follow-ups
  await tx
    .update(followUps)
    .set({
      organizationId: canonicalOrgId,
      organizationLocationId: locationId,
      updatedAt: now,
    })
    .where(eq(followUps.organizationId, sourceOrgId));

  //  5. Move call sessions
  await tx
    .update(callSessions)
    .set({
      organizationId: canonicalOrgId,
      organizationLocationId: locationId,
    })
    .where(eq(callSessions.organizationId, sourceOrgId));
}

/** Auto-derive a location label from city/region/name. */
function deriveLocationLabel(org: {
  name: string;
  city: string | null;
  region: string | null;
}): string {
  const parts = [org.city, org.region].filter(Boolean);
  if (parts.length) return parts.join(", ");
  return org.name;
}

//  Redirect lookup

export type ConsolidationRedirect = {
  canonicalOrgId: string;
  /** The location record created for the retired org, if found. */
  locationId: string | null;
};

/**
 * If the given org has been consolidated, return the redirect target.
 * The location is found via the durable `consolidationSourceOrgId` link
 * written during the consolidation apply step.
 * Returns null if the org has not been consolidated.
 */
export async function getConsolidationRedirect(
  database: ConsolidationDatabase,
  retiredOrgId: string,
): Promise<ConsolidationRedirect | null> {
  const [org] = await database
    .select({
      id: organizations.id,
      consolidatedIntoId: organizations.consolidatedIntoId,
    })
    .from(organizations)
    .where(eq(organizations.id, retiredOrgId))
    .limit(1);

  if (!org?.consolidatedIntoId) return null;

  // Find the location created specifically for this retired org during consolidation.
  const [location] = await database
    .select({ id: organizationLocations.id })
    .from(organizationLocations)
    .where(
      and(
        eq(organizationLocations.organizationId, org.consolidatedIntoId),
        eq(organizationLocations.consolidationSourceOrgId, retiredOrgId),
      ),
    )
    .limit(1);

  return {
    canonicalOrgId: org.consolidatedIntoId,
    locationId: location?.id ?? null,
  };
}
