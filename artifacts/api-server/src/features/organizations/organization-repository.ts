import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNull,
  notInArray,
  type SQL,
  type SQLWrapper,
  sql,
} from "drizzle-orm";

import type { db as database } from "@/db/client";
import {
  actExternalLinks,
  actMigrationRecords,
  activities,
  bookings,
  callSessions,
  contacts,
  followUps,
  organizationContacts,
  organizationFamilyReviews,
  organizations,
  travelLegs,
} from "@/db/schema";
import { recordAuditEntry } from "@/features/audit/audit-service";
import { bookingStatusValues } from "@/features/bookings/booking-types";
import { isActiveStatus } from "@/features/follow-ups/follow-up-policy";
import type { SetLastResortInput } from "@/features/organizations/last-resort-input";
import type {
  FamilyCandidateEvidence,
  OrganizationFamilyRecord,
} from "@/features/organizations/organization-family-matcher";
import {
  discoverOrganizationFamilyCandidates,
  partitionOrganizationReviewGroups,
} from "@/features/organizations/organization-family-discovery";
export {
  discoverOrganizationFamilyCandidates,
  partitionOrganizationReviewGroups,
} from "@/features/organizations/organization-family-discovery";
import {
  createOrganizationParentInTransaction,
  HierarchyConflictError,
  setOrganizationParentsInTransaction,
} from "@/features/organizations/organization-hierarchy";

export type OrganizationPerson = {
  id: string;
  name: string;
  role: string | null;
  isPrimary: boolean;
  phone: string | null;
  email: string | null;
};
export type OrganizationContact = OrganizationPerson;

export type OrganizationParentSummary = {
  id: string;
  name: string;
  website: string | null;
};

export type OrganizationLocationSummary = {
  id: string;
  name: string;
  address1: string | null;
  address2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  website: string | null;
  localStatus: string | null;
  nextFollowUp: { id: string; kind: string; dueAt: Date } | null;
  nextBooking: {
    id: string;
    name: string;
    startsAt: Date | null;
    status: string;
  } | null;
  travelLeg: { id: string; name: string; color: string } | null;
  primaryContactName: string | null;
};

export type OrganizationHierarchyRollups = {
  locationCount: number;
  upcomingBookingCount: number;
  overdueFollowUpCount: number;
  travelLegs: Array<{ id: string; name: string; color: string }>;
  mostRecentContactAt: Date | null;
};

export type OrganizationLocationAggregateRecord = {
  id: string;
  name: string;
  address1: string | null;
  address2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  website: string | null;
  localStatus: string | null;
  nextFollowUpId: string | null;
  nextFollowUpKind: string | null;
  nextFollowUpDueAt: Date | null;
  nextBookingId: string | null;
  nextBookingName: string | null;
  nextBookingStartsAt: Date | null;
  nextBookingStatus: string | null;
  travelLegId: string | null;
  travelLegName: string | null;
  travelLegColor: string | null;
  primaryContactFirstName: string | null;
  primaryContactLastName: string | null;
};

export type OrganizationHierarchySummary = {
  parent: OrganizationParentSummary | null;
  locations: OrganizationLocationSummary[];
  rollups: OrganizationHierarchyRollups;
};

export type OrganizationBooking = {
  id: string;
  name: string;
  travelLeg: { id: string; name: string; color: string } | null;
};

export type OrganizationSummary = {
  id: string;
  name: string;
  lastResort: boolean;
  lastResortReason: string | null;
  lastResortChangedAt: Date | null;
  parent: OrganizationParentSummary | null;
  locations: OrganizationLocationSummary[];
  rollups: OrganizationHierarchyRollups;
  contacts: OrganizationContact[];
  bookings: OrganizationBooking[];
  contactTotal?: number;
  contactPage?: number;
  contactPageCount?: number;
  bookingTotal?: number;
  bookingPage?: number;
  bookingPageCount?: number;
};

export type OrganizationSummaryQuery = {
  contactPage: number;
  bookingPage: number;
  pageSize: number;
};

export type OrganizationListQuery = {
  search: string;
  lastResort: "all" | "only";
  travelLegId: string | null;
  page: number;
  pageSize: number;
};

export type OrganizationListRecord = Omit<
  OrganizationSummary,
  "contacts" | "bookings" | "parent" | "locations" | "rollups"
> & {
  contactCount: number;
  bookingCount: number;
  city: string | null;
  region: string | null;
  primaryContactName: string | null;
  parent: OrganizationParentSummary | null;
  locationCount: number;
};

export type OrganizationListPage = {
  records: OrganizationListRecord[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
};

/** Shared predicate for reads that only consider the live place-person association. */
export function activeOrganizationContactCondition(organizationId: string) {
  return and(
    eq(organizationContacts.organizationId, organizationId),
    eq(organizationContacts.active, true),
  )!;
}

export type DuplicateOrganizationGroup = {
  normalizedName: string;
  city: string;
  region: string;
  classification: "duplicate" | "location_candidate" | "ambiguous_location_candidate";
  groupKey: string | null;
  candidateIds: string[];
  evidence: FamilyCandidateEvidence[];
  organizations: OrganizationListRecord[];
};

export type OrganizationFamilyCandidateGroup = Omit<
  DuplicateOrganizationGroup,
  "organizations"
>;
export type OrganizationFamilyReviewRecord = {
  groupKey: string;
  candidateIds: string[];
  evidence: FamilyCandidateEvidence[];
  status: "proposed" | "not_related";
};

export type OrganizationFamilyActRelationship = {
  sourceOrganizationId: string;
  targetOrganizationId: string;
  provenance: "act_relationship";
};

export function organizationFamilyActRelationshipsQuery(): SQL {
  return sql`
    SELECT DISTINCT
      source_link.entity_id AS "sourceOrganizationId",
      target_link.entity_id AS "targetOrganizationId",
      'act_relationship'::text AS provenance
    FROM ${actMigrationRecords} AS left_relationship
    INNER JOIN ${actMigrationRecords} AS right_relationship
      ON right_relationship.run_id = left_relationship.run_id
      AND right_relationship.stream_type = 'company_contact'
      AND right_relationship.target_source_id = left_relationship.target_source_id
      AND right_relationship.source_id > left_relationship.source_id
    INNER JOIN ${actExternalLinks} AS source_link
      ON source_link.entity_type = 'organization'
      AND source_link.source_entity_type = 'company'
      AND source_link.act_record_id = left_relationship.source_id
      AND source_link.migration_run_id = left_relationship.run_id
    INNER JOIN ${actExternalLinks} AS target_link
      ON target_link.entity_type = 'organization'
      AND target_link.source_entity_type = 'company'
      AND target_link.act_record_id = right_relationship.source_id
      AND target_link.migration_run_id = right_relationship.run_id
    WHERE left_relationship.stream_type = 'company_contact'
      AND left_relationship.source_id IS NOT NULL
      AND left_relationship.target_source_id IS NOT NULL
      AND right_relationship.source_id IS NOT NULL
      AND source_link.entity_id <> target_link.entity_id
    ORDER BY source_link.entity_id, target_link.entity_id
  `;
}

type OrganizationFamilyActDatabase = Pick<DrizzleDatabase, "execute">;

export async function loadOrganizationFamilyActRelationships(
  database: OrganizationFamilyActDatabase,
): Promise<OrganizationFamilyActRelationship[]> {
  const result = await database.execute<OrganizationFamilyActRelationship>(
    organizationFamilyActRelationshipsQuery(),
  );
  return [...result.rows];
}

export async function discoverOrganizationFamilyCandidatesFromDatabase(
  database: OrganizationFamilyActDatabase,
  records: readonly OrganizationFamilyRecord[],
): Promise<OrganizationFamilyCandidateGroup[]> {
  return discoverOrganizationFamilyCandidates(
    records,
    await loadOrganizationFamilyActRelationships(database),
  );
}

export type OrganizationFamilyReviewInput =
  | {
      action: "make_locations";
      candidateIds: string[];
      parent:
        | { kind: "existing"; parentId: string }
        | { kind: "new"; name: string; website?: string; phone?: string };
    }
  | { action: "not_related"; candidateIds: string[] };

function organizationFamilyGroupKey(candidateIds: readonly string[]): string {
  return `organization-family:${[...candidateIds]
    .sort((left, right) => left.localeCompare(right, "en-US"))
    .join("|")}`;
}

export async function reviewOrganizationFamily(
  database: Pick<DrizzleDatabase, "transaction">,
  input: OrganizationFamilyReviewInput,
  changedAt: Date,
): Promise<void> {
  const candidateIds = [...new Set(input.candidateIds)].sort((left, right) =>
    left.localeCompare(right, "en-US"),
  );
  const groupKey = organizationFamilyGroupKey(candidateIds);

  await database.transaction(async (transaction) => {
    const [review] = await transaction
      .select({
        groupKey: organizationFamilyReviews.groupKey,
        candidateIds: organizationFamilyReviews.candidateIds,
        status: organizationFamilyReviews.status,
      })
      .from(organizationFamilyReviews)
      .where(eq(organizationFamilyReviews.groupKey, groupKey))
      .for("update");
    if (
      !review ||
      review.status !== "proposed" ||
      review.candidateIds.length !== candidateIds.length ||
      !review.candidateIds.every((id, index) => id === candidateIds[index])
    ) {
      throw new HierarchyConflictError(
        "This organization family changed. Refresh the review list and try again.",
      );
    }

    const standaloneRecords = await transaction
      .select()
      .from(organizations)
      .where(and(
        isNull(organizations.parentOrganizationId),
        sql`not exists (
          select 1 from ${organizations} as confirmed_location
          where confirmed_location.parent_organization_id = ${organizations.id}
        )`,
      ))
      .orderBy(asc(organizations.id))
      .for("update");
    const candidatesById = new Map(
      standaloneRecords.map((organization) => [organization.id, organization]),
    );
    if (!candidateIds.every((id) => candidatesById.has(id))) {
      throw new HierarchyConflictError(
        "This organization family changed. Refresh the review list and try again.",
      );
    }

    const currentGroups = await discoverOrganizationFamilyCandidatesFromDatabase(
      transaction,
      standaloneRecords,
    );
    const current = currentGroups.find(
      (group) =>
        group.groupKey === groupKey &&
        group.candidateIds.length === candidateIds.length &&
        group.candidateIds.every((id, index) => id === candidateIds[index]),
    );
    if (!current) {
      await transaction
        .delete(organizationFamilyReviews)
        .where(eq(organizationFamilyReviews.groupKey, groupKey));
      throw new HierarchyConflictError(
        "This organization family changed. Refresh the review list and try again.",
      );
    }

    if (input.action === "not_related") {
      await transaction
        .update(organizationFamilyReviews)
        .set({
          candidateIds,
          evidence: current.evidence,
          status: "not_related",
          updatedAt: changedAt,
        })
        .where(eq(organizationFamilyReviews.groupKey, groupKey));
      return;
    }

    if (input.parent.kind === "new") {
      await createOrganizationParentInTransaction(
        transaction,
        {
          name: input.parent.name,
          ...(input.parent.website ? { website: input.parent.website } : {}),
          ...(input.parent.phone ? { phone: input.parent.phone } : {}),
          childIds: candidateIds,
        },
        changedAt,
      );
    } else {
      await setOrganizationParentsInTransaction(
        transaction,
        { parentId: input.parent.parentId, childIds: candidateIds },
        changedAt,
      );
    }

    await transaction
      .delete(organizationFamilyReviews)
      .where(eq(organizationFamilyReviews.groupKey, groupKey));
  }, { isolationLevel: "serializable" });
}

export interface OrganizationRepository {
  setLastResort(input: SetLastResortInput, changedAt: Date): Promise<boolean>;
  getOrganizationSummary(
    organizationId: string,
    query?: OrganizationSummaryQuery,
  ): Promise<OrganizationSummary | null>;
  findDuplicates(): Promise<DuplicateOrganizationGroup[]>;
  mergeOrganizations(primaryId: string, duplicateIds: string[]): Promise<void>;
}

type DrizzleDatabase = typeof database;
type OrganizationMergeTransaction = Parameters<
  Parameters<DrizzleDatabase["transaction"]>[0]
>[0];

const organizationMergeFamilyConflictMessage =
  "These profiles may be locations of the same organization. Review the location group before merging.";

export async function assertOrganizationsMergeable(
  transaction: OrganizationMergeTransaction,
  ids: string[],
): Promise<void> {
  const selectedIds = [...new Set(ids)].sort((left, right) =>
    left.localeCompare(right, "en-US"),
  );
  const selectedIdSet = new Set(selectedIds);

  const proposedFamilies = await transaction
    .select({
      groupKey: organizationFamilyReviews.groupKey,
      candidateIds: organizationFamilyReviews.candidateIds,
    })
    .from(organizationFamilyReviews)
    .where(eq(organizationFamilyReviews.status, "proposed"))
    .orderBy(asc(organizationFamilyReviews.groupKey))
    .for("update");
  const relevantProposals = proposedFamilies.filter((review) =>
    review.candidateIds.some((candidateId) => selectedIdSet.has(candidateId)),
  );
  const lockedIds = [
    ...new Set([
      ...selectedIds,
      ...relevantProposals.flatMap((review) => review.candidateIds),
    ]),
  ].sort((left, right) => left.localeCompare(right, "en-US"));

  const lockedOrganizations = await transaction
    .select()
    .from(organizations)
    .where(inArray(organizations.id, lockedIds))
    .orderBy(asc(organizations.id))
    .for("update");
  const organizationById = new Map(
    lockedOrganizations.map((organization) => [organization.id, organization]),
  );
  const selectedOrganizations = selectedIds.flatMap((id) => {
    const organization = organizationById.get(id);
    return organization ? [organization] : [];
  });
  if (selectedOrganizations.length !== selectedIds.length) {
    throw new HierarchyConflictError(
      "A selected organization profile no longer exists.",
    );
  }

  const ownedLocations = await transaction
    .select({
      id: organizations.id,
      parentOrganizationId: organizations.parentOrganizationId,
    })
    .from(organizations)
    .where(inArray(organizations.parentOrganizationId, selectedIds))
    .orderBy(asc(organizations.id))
    .for("update");

  if (
    selectedOrganizations.some(
      (organization) => organization.parentOrganizationId !== null,
    ) ||
    ownedLocations.length > 0
  ) {
    throw new HierarchyConflictError(organizationMergeFamilyConflictMessage);
  }

  for (const proposal of relevantProposals) {
    const proposalRecords = proposal.candidateIds.flatMap((id) => {
      const organization = organizationById.get(id);
      return organization ? [organization] : [];
    });
    const currentGroups =
      proposalRecords.length === proposal.candidateIds.length
        ? await discoverOrganizationFamilyCandidatesFromDatabase(
            transaction,
            proposalRecords,
          )
        : [];
    const isCurrent = currentGroups.some(
      (group) =>
        group.groupKey === proposal.groupKey &&
        group.candidateIds.length === proposal.candidateIds.length &&
        group.candidateIds.every(
          (id, index) => id === proposal.candidateIds[index],
        ),
    );
    if (isCurrent) {
      throw new HierarchyConflictError(organizationMergeFamilyConflictMessage);
    }
    await transaction
      .delete(organizationFamilyReviews)
      .where(eq(organizationFamilyReviews.groupKey, proposal.groupKey));
  }
}

export async function persistProposedOrganizationFamilies(
  database: Pick<DrizzleDatabase, "transaction">,
  proposals: OrganizationFamilyCandidateGroup[],
): Promise<void> {
  const eligibleProposals = proposals.filter(
    (proposal) => proposal.groupKey && proposal.candidateIds.length >= 2,
  );
  if (!eligibleProposals.length) return;

  await database.transaction(async (transaction) => {
    const candidateIds = [
      ...new Set(
        eligibleProposals.flatMap((proposal) => proposal.candidateIds),
      ),
    ].sort((left, right) => left.localeCompare(right, "en-US"));

    const candidates = await transaction
      .select({
        id: organizations.id,
        parentOrganizationId: organizations.parentOrganizationId,
      })
      .from(organizations)
      .where(inArray(organizations.id, candidateIds))
      .orderBy(asc(organizations.id))
      .for("update");

    const ownedLocations = await transaction
      .select({
        id: organizations.id,
        parentOrganizationId: organizations.parentOrganizationId,
      })
      .from(organizations)
      .where(inArray(organizations.parentOrganizationId, candidateIds))
      .orderBy(asc(organizations.id))
      .for("update");

    const candidateById = new Map(
      candidates.map((candidate) => [candidate.id, candidate]),
    );
    const parentsWithLocations = new Set(
      ownedLocations.flatMap((location) =>
        location.parentOrganizationId
          ? [location.parentOrganizationId]
          : [],
      ),
    );
    const proposalsStillEligible = eligibleProposals.filter((proposal) =>
      proposal.candidateIds.every((candidateId) => {
        const candidate = candidateById.get(candidateId);
        return (
          candidate?.parentOrganizationId === null &&
          !parentsWithLocations.has(candidateId)
        );
      }),
    );
    if (!proposalsStillEligible.length) return;

    await transaction
      .insert(organizationFamilyReviews)
      .values(proposalsStillEligible.map((proposal) => ({
        groupKey: proposal.groupKey!,
        candidateIds: proposal.candidateIds,
        status: "proposed" as const,
        evidence: proposal.evidence,
      })))
      .onConflictDoNothing({ target: organizationFamilyReviews.groupKey });
  });
}


function lastResortSnapshot(record: typeof organizations.$inferSelect) {
  return {
    lastResort: record.lastResort,
    lastResortReason: record.lastResortReason,
    lastResortChangedAt: record.lastResortChangedAt?.toISOString() ?? null,
  };
}

function toOrganizationBooking(record: {
  booking: typeof bookings.$inferSelect;
  travelLeg: typeof travelLegs.$inferSelect | null;
}): OrganizationBooking {
  return {
    id: record.booking.id,
    name: record.booking.name,
    travelLeg: record.travelLeg
      ? {
          id: record.travelLeg.id,
          name: record.travelLeg.name,
          color: record.travelLeg.color,
        }
      : null,
  };
}



const emptyHierarchyRollupRecord = {
  locationCount: 0,
  upcomingBookingCount: 0,
  overdueFollowUpCount: 0,
  mostRecentContactAt: null,
};

export function assembleOrganizationHierarchy(
  parent: OrganizationParentSummary | null,
  locationRecords: OrganizationLocationAggregateRecord[],
  rollupRecord: Omit<OrganizationHierarchyRollups, "travelLegs"> = emptyHierarchyRollupRecord,
  representedTravelLegs: OrganizationHierarchyRollups["travelLegs"] = [],
): OrganizationHierarchySummary {
  return {
    parent,
    locations: locationRecords
      .map((record) => ({
        id: record.id,
        name: record.name,
        address1: record.address1,
        address2: record.address2,
        city: record.city,
        region: record.region,
        postalCode: record.postalCode,
        website: record.website,
        localStatus: record.localStatus,
        nextFollowUp:
          record.nextFollowUpId &&
          record.nextFollowUpKind &&
          record.nextFollowUpDueAt
            ? {
                id: record.nextFollowUpId,
                kind: record.nextFollowUpKind,
                dueAt: record.nextFollowUpDueAt,
              }
            : null,
        nextBooking:
          record.nextBookingId &&
          record.nextBookingName &&
          record.nextBookingStatus
            ? {
                id: record.nextBookingId,
                name: record.nextBookingName,
                startsAt: record.nextBookingStartsAt,
                status: record.nextBookingStatus,
              }
            : null,
        travelLeg:
          record.travelLegId &&
          record.travelLegName &&
          record.travelLegColor
            ? {
                id: record.travelLegId,
                name: record.travelLegName,
                color: record.travelLegColor,
              }
            : null,
        primaryContactName:
          record.primaryContactFirstName || record.primaryContactLastName
            ? `${record.primaryContactFirstName ?? ""} ${record.primaryContactLastName ?? ""}`.trim()
            : null,
      }))
      .toSorted(
        (left, right) =>
          left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
      ),
    rollups: {
      locationCount: Number(rollupRecord.locationCount),
      upcomingBookingCount: Number(rollupRecord.upcomingBookingCount),
      overdueFollowUpCount: Number(rollupRecord.overdueFollowUpCount),
      travelLegs: representedTravelLegs,
      mostRecentContactAt: rollupRecord.mostRecentContactAt,
    },
  };
}


const activeBookingStatuses = bookingStatusValues.filter(isActiveStatus);

function activeBookingStatusCondition(status: SQLWrapper): SQL {
  return sql`${status} in (${sql.join(
    activeBookingStatuses.map((value) => sql`${value}`),
    sql`, `,
  )})`;
}

export function organizationOwnedRecordCondition(
  columns: {
    organizationId: SQLWrapper;
    bookingId: SQLWrapper;
    contactId: SQLWrapper;
  },
  matchesExplicitOrganization: SQL,
  matchesBookingOrganization: SQL,
  matchesContactAssociation: SQL,
): SQL {
  return sql`(
    (${columns.organizationId} is not null and ${matchesExplicitOrganization})
    or (
      ${columns.organizationId} is null
      and ${columns.bookingId} is not null
      and ${matchesBookingOrganization}
    )
    or (
      ${columns.organizationId} is null
      and ${columns.bookingId} is null
      and ${columns.contactId} is not null
      and ${matchesContactAssociation}
    )
  )`;
}

export function organizationHierarchyLocationQuery(parentId: string): SQL {
  return sql`
    SELECT
      child.id,
      child.name,
      child.address_1 AS "address1",
      child.address_2 AS "address2",
      child.city,
      child.region,
      child.postal_code AS "postalCode",
      child.website,
      next_booking.status::text AS "localStatus",
      next_follow_up.id AS "nextFollowUpId",
      next_follow_up.kind AS "nextFollowUpKind",
      next_follow_up.due_at AS "nextFollowUpDueAt",
      next_booking.id AS "nextBookingId",
      next_booking.name AS "nextBookingName",
      next_booking.starts_at AS "nextBookingStartsAt",
      next_booking.status::text AS "nextBookingStatus",
      next_leg.id AS "travelLegId",
      next_leg.name AS "travelLegName",
      next_leg.color AS "travelLegColor",
      primary_contact.first_name AS "primaryContactFirstName",
      primary_contact.last_name AS "primaryContactLastName"
    FROM ${organizations} AS child
    LEFT JOIN LATERAL (
      SELECT
        candidate.id,
        candidate.kind,
        candidate.due_at
      FROM ${followUps} AS candidate
      WHERE candidate.completed_at IS NULL
        AND ${organizationOwnedRecordCondition(
          {
            organizationId: sql`candidate.organization_id`,
            bookingId: sql`candidate.booking_id`,
            contactId: sql`candidate.contact_id`,
          },
          sql`candidate.organization_id = child.id`,
          sql`EXISTS (
            SELECT 1
            FROM ${bookings} AS related_booking
            WHERE related_booking.organization_id = child.id
              AND related_booking.id = candidate.booking_id
          )`,
          sql`EXISTS (
            SELECT 1
            FROM ${organizationContacts} AS association
            WHERE association.organization_id = child.id
              AND association.active
              AND association.contact_id = candidate.contact_id
          )`,
        )}
      ORDER BY candidate.due_at, candidate.id
      LIMIT 1
    ) AS next_follow_up ON true
    LEFT JOIN LATERAL (
      SELECT
        candidate.id,
        candidate.name,
        candidate.starts_at,
        candidate.status,
        candidate.travel_leg_id
      FROM ${bookings} AS candidate
      WHERE candidate.organization_id = child.id
        AND candidate.starts_at >= now()
        AND ${activeBookingStatusCondition(sql`candidate.status`)}
      ORDER BY candidate.starts_at, candidate.id
      LIMIT 1
    ) AS next_booking ON true
    LEFT JOIN ${travelLegs} AS next_leg
      ON next_leg.id = next_booking.travel_leg_id
    LEFT JOIN LATERAL (
      SELECT person.first_name, person.last_name
      FROM ${organizationContacts} AS association
      INNER JOIN ${contacts} AS person ON person.id = association.contact_id
      WHERE association.organization_id = child.id
        AND association.active
        AND association.is_primary
      ORDER BY association.updated_at DESC, association.id
      LIMIT 1
    ) AS primary_contact ON true
    WHERE child.parent_organization_id = ${parentId}
    ORDER BY child.name, child.id
  `;
}

export function organizationHierarchyRollupQuery(parentId: string): SQL {
  return sql`
    SELECT
      count(*)::int AS "locationCount",
      (
        SELECT count(*)::int
        FROM ${bookings} AS candidate
        INNER JOIN ${organizations} AS booking_location
          ON booking_location.id = candidate.organization_id
        WHERE booking_location.parent_organization_id = ${parentId}
          AND candidate.starts_at >= now()
          AND ${activeBookingStatusCondition(sql`candidate.status`)}
      ) AS "upcomingBookingCount",
      (
        SELECT count(*)::int
        FROM ${followUps} AS candidate
        WHERE candidate.completed_at IS NULL
          AND candidate.due_at < now()
          AND ${organizationOwnedRecordCondition(
            {
              organizationId: sql`candidate.organization_id`,
              bookingId: sql`candidate.booking_id`,
              contactId: sql`candidate.contact_id`,
            },
            sql`EXISTS (
              SELECT 1
              FROM ${organizations} AS direct_location
              WHERE direct_location.parent_organization_id = ${parentId}
                AND direct_location.id = candidate.organization_id
            )`,
            sql`EXISTS (
              SELECT 1
              FROM ${bookings} AS related_booking
              INNER JOIN ${organizations} AS booking_location
                ON booking_location.id = related_booking.organization_id
              WHERE booking_location.parent_organization_id = ${parentId}
                AND related_booking.id = candidate.booking_id
            )`,
            sql`EXISTS (
              SELECT 1
              FROM ${organizationContacts} AS association
              INNER JOIN ${organizations} AS contact_location
                ON contact_location.id = association.organization_id
              WHERE contact_location.parent_organization_id = ${parentId}
                AND association.active
                AND association.contact_id = candidate.contact_id
            )`,
          )}
      ) AS "overdueFollowUpCount",
      (
        SELECT max(candidate.timeline_sort_at)
        FROM ${activities} AS candidate
        WHERE candidate.kind = 'call'
          AND ${organizationOwnedRecordCondition(
            {
              organizationId: sql`candidate.organization_id`,
              bookingId: sql`candidate.booking_id`,
              contactId: sql`candidate.contact_id`,
            },
            sql`EXISTS (
              SELECT 1
              FROM ${organizations} AS direct_location
              WHERE direct_location.parent_organization_id = ${parentId}
                AND direct_location.id = candidate.organization_id
            )`,
            sql`EXISTS (
              SELECT 1
              FROM ${bookings} AS related_booking
              INNER JOIN ${organizations} AS booking_location
                ON booking_location.id = related_booking.organization_id
              WHERE booking_location.parent_organization_id = ${parentId}
                AND related_booking.id = candidate.booking_id
            )`,
            sql`EXISTS (
              SELECT 1
              FROM ${organizationContacts} AS association
              INNER JOIN ${organizations} AS contact_location
                ON contact_location.id = association.organization_id
              WHERE contact_location.parent_organization_id = ${parentId}
                AND association.active
                AND association.contact_id = candidate.contact_id
            )`,
          )}
      ) AS "mostRecentContactAt"
    FROM ${organizations} AS child
    WHERE child.parent_organization_id = ${parentId}
  `;
}

export function organizationHierarchyTravelLegQuery(parentId: string): SQL {
  return sql`
    SELECT DISTINCT leg.id, leg.name, leg.color
    FROM ${organizations} AS child
    INNER JOIN ${bookings} AS child_booking
      ON child_booking.organization_id = child.id
    INNER JOIN ${travelLegs} AS leg
      ON leg.id = child_booking.travel_leg_id
    WHERE child.parent_organization_id = ${parentId}
    ORDER BY leg.name, leg.id
  `;
}

export async function loadOrganizationHierarchySummary(
  database: DrizzleDatabase,
  organization: { id: string; parentOrganizationId: string | null },
): Promise<OrganizationHierarchySummary> {
  if (organization.parentOrganizationId) {
    const [parent] = await database
      .select({
        id: organizations.id,
        name: organizations.name,
        website: organizations.website,
      })
      .from(organizations)
      .where(eq(organizations.id, organization.parentOrganizationId))
      .limit(1);

    return assembleOrganizationHierarchy(parent ?? null, []);
  }

  const [locationResult, rollupResult, travelLegResult] = await Promise.all([
    database.execute<OrganizationLocationAggregateRecord>(
      organizationHierarchyLocationQuery(organization.id),
    ),
    database.execute<Omit<OrganizationHierarchyRollups, "travelLegs">>(
      organizationHierarchyRollupQuery(organization.id),
    ),
    database.execute<OrganizationHierarchyRollups["travelLegs"][number]>(
      organizationHierarchyTravelLegQuery(organization.id),
    ),
  ]);

  return assembleOrganizationHierarchy(
    null,
    [...locationResult.rows],
    rollupResult.rows[0] ?? emptyHierarchyRollupRecord,
    [...travelLegResult.rows],
  );
}

export function buildOrganizationListCondition(
  query: OrganizationListQuery,
): SQL | undefined {
  const pattern = `%${query.search}%`;
  const searchCondition = query.search
    ? sql`(
        ${organizations.name} ilike ${pattern}
        or ${organizations.city} ilike ${pattern}
        or ${organizations.phone} ilike ${pattern}
        or exists (
          select 1
          from ${organizations} as parent_organization
          where parent_organization.id = ${organizations.parentOrganizationId}
            and parent_organization.name ilike ${pattern}
        )
        or exists (
          select 1
          from ${organizationContacts} as association
          inner join ${contacts} as person
            on person.id = association.contact_id
          where association.organization_id = ${organizations.id}
            and association.active
            and (
              person.first_name ilike ${pattern}
              or person.last_name ilike ${pattern}
              or concat_ws(' ', person.first_name, person.last_name) ilike ${pattern}
              or person.phone ilike ${pattern}
              or person.email ilike ${pattern}
            )
        )
        or exists (
          select 1
          from ${organizations} as child_location
          where child_location.parent_organization_id = ${organizations.id}
            and (
              child_location.name ilike ${pattern}
              or child_location.city ilike ${pattern}
              or child_location.phone ilike ${pattern}
              or exists (
                select 1
                from ${organizationContacts} as child_association
                inner join ${contacts} as child_person
                  on child_person.id = child_association.contact_id
                where child_association.organization_id = child_location.id
                  and child_association.active
                  and (
                    child_person.first_name ilike ${pattern}
                    or child_person.last_name ilike ${pattern}
                    or concat_ws(
                      ' ',
                      child_person.first_name,
                      child_person.last_name
                    ) ilike ${pattern}
                    or child_person.phone ilike ${pattern}
                    or child_person.email ilike ${pattern}
                  )
              )
            )
        )
      )`
    : isNull(organizations.parentOrganizationId);
  const lastResortCondition =
    query.lastResort === "only" ? eq(organizations.lastResort, true) : undefined;
  const travelLegCondition = query.travelLegId
    ? sql`exists (select 1 from ${bookings} where ${bookings.organizationId} = ${organizations.id} and ${bookings.travelLegId} = ${query.travelLegId})`
    : undefined;

  return and(searchCondition, lastResortCondition, travelLegCondition) ?? undefined;
}

export function buildOrganizationListOrderBy(
  query: OrganizationListQuery,
): SQL[] {
  return query.search
    ? [
        sql`case
          when lower(${organizations.name}) = lower(${query.search}) then 0
          when ${organizations.parentOrganizationId} is null then 1
          else 2
        end`,
        asc(organizations.name),
        asc(organizations.id),
      ]
    : [asc(organizations.name), asc(organizations.id)];
}

/** Candidate groups are intentionally name-based; location gaps are common in imported profiles. */
export function duplicateOrganizationGroupsQuery() {
  return sql`
    SELECT
      lower(trim(name)) AS normalized_name,
      min(lower(trim(coalesce(city, '')))) AS normalized_city,
      min(lower(trim(coalesce(region, '')))) AS normalized_region,
      array_agg(id ORDER BY created_at ASC) AS ids
    FROM organizations AS duplicate_candidate
    WHERE parent_organization_id IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM organizations AS confirmed_location
        WHERE confirmed_location.parent_organization_id = duplicate_candidate.id
      )
    GROUP BY 1
    HAVING count(*) > 1
    ORDER BY lower(trim(name))
  `;
}

export class DrizzleOrganizationRepository implements OrganizationRepository {
  constructor(private readonly database: DrizzleDatabase) {}

  async setLastResort(
    input: SetLastResortInput,
    changedAt: Date,
  ): Promise<boolean> {
    return this.database.transaction(async (transaction) => {
      const [before] = await transaction
        .select()
        .from(organizations)
        .where(eq(organizations.id, input.organizationId))
        .limit(1)
        .for("update");
      if (!before) return false;

      const [updated] = await transaction
        .update(organizations)
        .set({
          lastResort: input.enabled,
          lastResortReason: input.enabled ? input.reason : null,
          lastResortChangedAt: changedAt,
          updatedAt: changedAt,
        })
        .where(eq(organizations.id, input.organizationId))
        .returning();
      if (!updated) throw new Error("Could not update the organization.");

      await recordAuditEntry(transaction, {
        entityType: "organization",
        entityId: input.organizationId,
        action: input.enabled ? "last_resort_enabled" : "last_resort_cleared",
        before: lastResortSnapshot(before),
        after: lastResortSnapshot(updated),
      });
      return true;
    });
  }

  async getOrganizationSummary(
    organizationId: string,
    query: OrganizationSummaryQuery = {
      contactPage: 1,
      bookingPage: 1,
      pageSize: 25,
    },
  ): Promise<OrganizationSummary | null> {
    const [organization] = await this.database
      .select()
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);
    if (!organization) return null;

    const [[contactTotalRecord], [bookingTotalRecord]] = await Promise.all([
      this.database
        .select({ value: count() })
        .from(organizationContacts)
        .where(and(
          eq(organizationContacts.organizationId, organizationId),
          eq(organizationContacts.active, true),
        )),
      this.database
        .select({ value: count() })
        .from(bookings)
        .where(eq(bookings.organizationId, organizationId)),
    ]);
    const contactTotal = contactTotalRecord?.value ?? 0;
    const bookingTotal = bookingTotalRecord?.value ?? 0;
    const contactPageCount = Math.max(1, Math.ceil(contactTotal / query.pageSize));
    const bookingPageCount = Math.max(1, Math.ceil(bookingTotal / query.pageSize));
    const contactPage = Math.min(
      Math.max(1, query.contactPage),
      contactPageCount,
    );
    const bookingPage = Math.min(
      Math.max(1, query.bookingPage),
      bookingPageCount,
    );

    const [organizationPeople, organizationBookings, hierarchy] = await Promise.all([
      this.database
        .select({
          id: contacts.id,
          firstName: contacts.firstName,
          lastName: contacts.lastName,
          role: organizationContacts.role,
          isPrimary: organizationContacts.isPrimary,
          phone: contacts.phone,
          email: contacts.email,
        })
        .from(organizationContacts)
        .innerJoin(contacts, eq(organizationContacts.contactId, contacts.id))
        .where(and(
          eq(organizationContacts.organizationId, organizationId),
          eq(organizationContacts.active, true),
        ))
        .orderBy(
          desc(organizationContacts.isPrimary),
          asc(organizationContacts.role),
          asc(contacts.lastName),
          asc(contacts.firstName),
          asc(contacts.id),
        )
        .limit(query.pageSize)
        .offset((contactPage - 1) * query.pageSize),
      this.database
        .select({ booking: bookings, travelLeg: travelLegs })
        .from(bookings)
        .leftJoin(travelLegs, eq(bookings.travelLegId, travelLegs.id))
        .where(eq(bookings.organizationId, organizationId))
        .orderBy(desc(bookings.startsAt), asc(bookings.name), asc(bookings.id))
        .limit(query.pageSize)
        .offset((bookingPage - 1) * query.pageSize),
      loadOrganizationHierarchySummary(this.database, organization),
    ]);

    return {
      id: organization.id,
      name: organization.name,
      lastResort: organization.lastResort,
      lastResortReason: organization.lastResortReason,
      lastResortChangedAt: organization.lastResortChangedAt,
      ...hierarchy,
      contacts: organizationPeople.map((contact) => ({
        id: contact.id,
        name: `${contact.firstName} ${contact.lastName}`.trim(),
        role: contact.role,
        isPrimary: contact.isPrimary,
        phone: contact.phone,
        email: contact.email,
      })),
      bookings: organizationBookings.map(toOrganizationBooking),
      contactTotal,
      contactPage,
      contactPageCount,
      bookingTotal,
      bookingPage,
      bookingPageCount,
    };
  }

  async listOrganizations(query: OrganizationListQuery): Promise<OrganizationListPage> {
    const condition = buildOrganizationListCondition(query);
    const [totals] = await this.database
      .select({ value: count() })
      .from(organizations)
      .where(condition);
    const total = totals?.value ?? 0;
    const pageCount = Math.max(1, Math.ceil(total / query.pageSize));
    const page = Math.min(query.page, pageCount);
    const organizationRecords = await this.database
      .select()
      .from(organizations)
      .where(condition)
      .orderBy(...buildOrganizationListOrderBy(query))
      .limit(query.pageSize)
      .offset((page - 1) * query.pageSize);
    if (!organizationRecords.length) {
      return { records: [], total, page, pageSize: query.pageSize, pageCount };
    }

    const organizationIds = organizationRecords.map((organization) => organization.id);
    const parentIds = [
      ...new Set(
        organizationRecords
          .map((organization) => organization.parentOrganizationId)
          .filter((id): id is string => id !== null),
      ),
    ];
    const [
      contactCounts,
      bookingCounts,
      primaryContacts,
      parentRecords,
      locationCounts,
    ] = await Promise.all([
      this.database
        .select({
          organizationId: organizationContacts.organizationId,
          value: count(),
        })
        .from(organizationContacts)
        .where(and(
          inArray(organizationContacts.organizationId, organizationIds),
          eq(organizationContacts.active, true),
        ))
        .groupBy(organizationContacts.organizationId),
      this.database
        .select({
          organizationId: bookings.organizationId,
          value: count(),
        })
        .from(bookings)
        .where(inArray(bookings.organizationId, organizationIds))
        .groupBy(bookings.organizationId),
      this.database
        .select({
          organizationId: organizationContacts.organizationId,
          firstName: contacts.firstName,
          lastName: contacts.lastName,
        })
        .from(organizationContacts)
        .innerJoin(contacts, eq(organizationContacts.contactId, contacts.id))
        .where(and(
          inArray(organizationContacts.organizationId, organizationIds),
          eq(organizationContacts.active, true),
          eq(organizationContacts.isPrimary, true),
        )),
      parentIds.length
        ? this.database
            .select({
              id: organizations.id,
              name: organizations.name,
              website: organizations.website,
            })
            .from(organizations)
            .where(inArray(organizations.id, parentIds))
        : Promise.resolve([] as OrganizationParentSummary[]),
      this.database
        .select({
          parentOrganizationId: organizations.parentOrganizationId,
          value: count(),
        })
        .from(organizations)
        .where(inArray(organizations.parentOrganizationId, organizationIds))
        .groupBy(organizations.parentOrganizationId),
    ]);
    const contactCountByOrganization = new Map(
      contactCounts.map((record) => [record.organizationId, record.value]),
    );
    const bookingCountByOrganization = new Map(
      bookingCounts
        .filter((record) => record.organizationId !== null)
        .map((record) => [record.organizationId!, record.value]),
    );
    const primaryContactByOrganization = new Map(
      primaryContacts.map((record) => [
        record.organizationId,
        `${record.firstName} ${record.lastName}`.trim(),
      ]),
    );
    const parentById = new Map(
      parentRecords.map((record) => [record.id, record]),
    );
    const locationCountByParent = new Map(
      locationCounts
        .filter((record) => record.parentOrganizationId !== null)
        .map((record) => [record.parentOrganizationId!, record.value]),
    );

    return {
      records: organizationRecords.map((organization) => ({
        id: organization.id,
        name: organization.name,
        city: organization.city,
        region: organization.region,
        lastResort: organization.lastResort,
        lastResortReason: organization.lastResortReason,
        lastResortChangedAt: organization.lastResortChangedAt,
        contactCount: contactCountByOrganization.get(organization.id) ?? 0,
        bookingCount: bookingCountByOrganization.get(organization.id) ?? 0,
        primaryContactName: primaryContactByOrganization.get(organization.id) ?? null,
        parent: organization.parentOrganizationId
          ? parentById.get(organization.parentOrganizationId) ?? null
          : null,
        locationCount: locationCountByParent.get(organization.id) ?? 0,
      })),
      total,
      page,
      pageSize: query.pageSize,
      pageCount,
    };
  }

  async listTravelLegs() {
    return this.database
      .select({ id: travelLegs.id, name: travelLegs.name, color: travelLegs.color })
      .from(travelLegs)
      .orderBy(asc(travelLegs.sortOrder));
  }

  async findDuplicates(): Promise<DuplicateOrganizationGroup[]> {
    const [groupRows, familyRecords] = await Promise.all([
      this.database.execute<{
        normalized_name: string;
        normalized_city: string;
        normalized_region: string;
        ids: string[];
      }>(duplicateOrganizationGroupsQuery()),
      this.database
        .select()
        .from(organizations)
        .where(and(
          isNull(organizations.parentOrganizationId),
          sql`not exists (
            select 1 from ${organizations} as confirmed_location
            where confirmed_location.parent_organization_id = ${organizations.id}
          )`,
        ))
        .orderBy(asc(organizations.id)),
    ]);

    const discoveredFamilies =
      await discoverOrganizationFamilyCandidatesFromDatabase(
        this.database,
        familyRecords,
      );
    const familyKeys = discoveredFamilies.flatMap((group) =>
      group.groupKey ? [group.groupKey] : [],
    );
    const reviews = await this.database
      .select()
      .from(organizationFamilyReviews);
    const staleProposedKeys = reviews
      .filter(
        (review) =>
          review.status === "proposed" && !familyKeys.includes(review.groupKey),
      )
      .map((review) => review.groupKey);
    if (staleProposedKeys.length) {
      await this.database
        .delete(organizationFamilyReviews)
        .where(and(
          eq(organizationFamilyReviews.status, "proposed"),
          inArray(organizationFamilyReviews.groupKey, staleProposedKeys),
          familyKeys.length
            ? notInArray(organizationFamilyReviews.groupKey, familyKeys)
            : sql`true`,
        ));
    }
    const currentReviews = reviews.filter(
      (review) => !staleProposedKeys.includes(review.groupKey),
    );
    const reviewByKey = new Map(currentReviews.map((review) => [review.groupKey, review]));
    const reviewGroups = partitionOrganizationReviewGroups(
      groupRows.rows,
      discoveredFamilies,
      currentReviews,
    );
    const visibleFamilies = reviewGroups.filter(
      (group) => group.classification !== "duplicate",
    );
    const proposedFamilies = visibleFamilies.filter(
      (group) => group.groupKey && !reviewByKey.has(group.groupKey),
    );
    if (proposedFamilies.length) {
      await persistProposedOrganizationFamilies(
        this.database,
        proposedFamilies,
      );
    }

    const allIds = [...new Set(reviewGroups.flatMap((group) => group.candidateIds))];
    if (!allIds.length) return [];

    const orgRecords = await this.database
      .select()
      .from(organizations)
      .where(inArray(organizations.id, allIds))
      .orderBy(asc(organizations.name), asc(organizations.id));
    const organizationIds = orgRecords.map((organization) => organization.id);
    const parentIds = [...new Set(
      orgRecords
        .map((organization) => organization.parentOrganizationId)
        .filter((id): id is string => id !== null),
    )];

    const [contactCounts, bookingCounts, primaryContacts, parentRecords, locationCounts] =
      await Promise.all([
        this.database
          .select({ organizationId: organizationContacts.organizationId, value: count() })
          .from(organizationContacts)
          .where(and(
            inArray(organizationContacts.organizationId, organizationIds),
            eq(organizationContacts.active, true),
          ))
          .groupBy(organizationContacts.organizationId),
        this.database
          .select({ organizationId: bookings.organizationId, value: count() })
          .from(bookings)
          .where(inArray(bookings.organizationId, organizationIds))
          .groupBy(bookings.organizationId),
        this.database
          .select({
            organizationId: organizationContacts.organizationId,
            firstName: contacts.firstName,
            lastName: contacts.lastName,
          })
          .from(organizationContacts)
          .innerJoin(contacts, eq(organizationContacts.contactId, contacts.id))
          .where(and(
            inArray(organizationContacts.organizationId, organizationIds),
            eq(organizationContacts.active, true),
            eq(organizationContacts.isPrimary, true),
          )),
        parentIds.length
          ? this.database
              .select({ id: organizations.id, name: organizations.name, website: organizations.website })
              .from(organizations)
              .where(inArray(organizations.id, parentIds))
          : Promise.resolve([] as OrganizationParentSummary[]),
        this.database
          .select({ parentOrganizationId: organizations.parentOrganizationId, value: count() })
          .from(organizations)
          .where(inArray(organizations.parentOrganizationId, organizationIds))
          .groupBy(organizations.parentOrganizationId),
      ]);

    const contactCountByOrg = new Map(contactCounts.map((record) => [record.organizationId, record.value]));
    const bookingCountByOrg = new Map(
      bookingCounts.filter((record) => record.organizationId !== null)
        .map((record) => [record.organizationId!, record.value]),
    );
    const primaryContactByOrg = new Map(
      primaryContacts.map((record) => [
        record.organizationId,
        `${record.firstName} ${record.lastName}`.trim(),
      ]),
    );
    const parentById = new Map(parentRecords.map((record) => [record.id, record]));
    const locationCountByParent = new Map(
      locationCounts.filter((record) => record.parentOrganizationId !== null)
        .map((record) => [record.parentOrganizationId!, record.value]),
    );
    const orgById = new Map(orgRecords.map((organization) => [organization.id, organization]));

    return reviewGroups
      .map((group) => ({
        ...group,
        organizations: group.candidateIds.flatMap((id) => {
          const organization = orgById.get(id);
          if (!organization) return [];
          return [{
            id: organization.id,
            name: organization.name,
            city: organization.city,
            region: organization.region,
            lastResort: organization.lastResort,
            lastResortReason: organization.lastResortReason,
            lastResortChangedAt: organization.lastResortChangedAt,
            contactCount: contactCountByOrg.get(organization.id) ?? 0,
            bookingCount: bookingCountByOrg.get(organization.id) ?? 0,
            primaryContactName: primaryContactByOrg.get(organization.id) ?? null,
            parent: organization.parentOrganizationId
              ? parentById.get(organization.parentOrganizationId) ?? null
              : null,
            locationCount: locationCountByParent.get(organization.id) ?? 0,
          } satisfies OrganizationListRecord];
        }),
      }))
      .filter((group) => group.organizations.length === group.candidateIds.length);
  }

  async saveFamilyReview(review: OrganizationFamilyReviewRecord): Promise<void> {
    const now = new Date();
    await this.database
      .insert(organizationFamilyReviews)
      .values({
        groupKey: review.groupKey,
        candidateIds: review.candidateIds,
        evidence: review.evidence,
        status: review.status,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: organizationFamilyReviews.groupKey,
        set: {
          candidateIds: review.candidateIds,
          evidence: review.evidence,
          status: review.status,
          updatedAt: now,
        },
      });
  }

  async deleteFamilyReview(groupKey: string): Promise<void> {
    await this.database
      .delete(organizationFamilyReviews)
      .where(eq(organizationFamilyReviews.groupKey, groupKey));
  }

  async mergeOrganizations(primaryId: string, duplicateIds: string[]): Promise<void> {
    if (!duplicateIds.length) return;

    await this.database.transaction(async (tx) => {
      await assertOrganizationsMergeable(tx, [primaryId, ...duplicateIds]);
      const now = new Date();

      for (const dupId of duplicateIds) {
        // Step 1: Create organization_contacts entries on the primary for every
        // contact currently belonging to the duplicate. This MUST happen before
        // updating contacts.organization_id because the schema enforces a
        // composite FK: contacts(organization_id, id) →
        // organization_contacts(organization_id, contact_id). Without a matching
        // row on the primary side the FK check would fail when we re-parent
        // contacts in step 2.
        //
        // Force isPrimary=false on incoming rows so we never violate the
        // one-active-primary-per-org partial unique index. The primary's
        // existing primary designation is left untouched.
        await tx.execute(sql`
          INSERT INTO organization_contacts
            (id, organization_id, contact_id, role, is_primary, active, source, created_at, updated_at)
          SELECT
            gen_random_uuid(),
            ${primaryId},
            contact_id,
            role,
            false,
            active,
            source,
            created_at,
            ${now}
          FROM organization_contacts
          WHERE organization_id = ${dupId}
          ON CONFLICT (organization_id, contact_id) DO NOTHING
        `);

        // Step 2: Re-parent contacts — now safe because every contact that had
        // organization_id = dupId has a matching organization_contacts row for
        // primaryId (inserted above or already present).
        await tx.update(contacts)
          .set({ organizationId: primaryId, updatedAt: now })
          .where(eq(contacts.organizationId, dupId));

        // Step 3: Remove the now-redundant organization_contacts rows for the
        // duplicate. Contacts no longer point to dupId, so no FK is violated.
        await tx.delete(organizationContacts)
          .where(eq(organizationContacts.organizationId, dupId));

        // Step 4: Re-parent bookings
        await tx.update(bookings)
          .set({ organizationId: primaryId, updatedAt: now })
          .where(eq(bookings.organizationId, dupId));

        // Step 5: Re-parent follow_ups
        await tx.update(followUps)
          .set({ organizationId: primaryId })
          .where(eq(followUps.organizationId, dupId));

        // Step 6: Re-parent activities
        await tx.update(activities)
          .set({ organizationId: primaryId, updatedAt: now })
          .where(eq(activities.organizationId, dupId));

        // Step 7: Re-parent call_sessions
        await tx.update(callSessions)
          .set({ organizationId: primaryId })
          .where(eq(callSessions.organizationId, dupId));

        // Step 8: Re-parent act_external_links.
        // Clear isPrimary first to avoid the one-primary-per-local-source
        // partial unique index conflict before changing entityId.
        await tx.update(actExternalLinks)
          .set({ isPrimary: false })
          .where(and(
            eq(actExternalLinks.entityId, dupId),
            eq(actExternalLinks.entityType, "organization"),
          ));
        await tx.update(actExternalLinks)
          .set({ entityId: primaryId, updatedAt: now })
          .where(and(
            eq(actExternalLinks.entityId, dupId),
            eq(actExternalLinks.entityType, "organization"),
          ));

        // Step 9: Re-parent act_migration_records matched/applied entity pointers
        await tx.update(actMigrationRecords)
          .set({ matchedEntityId: primaryId, updatedAt: now })
          .where(and(
            eq(actMigrationRecords.matchedEntityId, dupId),
            eq(actMigrationRecords.matchedEntityType, "organization"),
          ));
        await tx.update(actMigrationRecords)
          .set({ appliedEntityId: primaryId, updatedAt: now })
          .where(and(
            eq(actMigrationRecords.appliedEntityId, dupId),
            eq(actMigrationRecords.matchedEntityType, "organization"),
          ));

        // Step 10: Delete the now-empty duplicate
        await tx.delete(organizations).where(eq(organizations.id, dupId));
      }
    });
  }
}
