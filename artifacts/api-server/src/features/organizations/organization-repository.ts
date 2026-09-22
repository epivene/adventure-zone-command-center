import { reconcileCapacityFacts } from "@/features/outreach-planner/outreach-commitments";
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNull,
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
  eventDateFacts,
  followUps,
  organizationContacts,
  organizationFamilyReviews,
  eventFamilyMembers,
  organizationLocations,
  organizations,
  travelLegs,
} from "@/db/schema";
import { resolveEffectiveEventDate } from "@/features/event-date-coverage/effective-event-date";
import type { EffectiveEventDate } from "@/features/event-date-coverage/event-date-types";
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
  OrganizationConflictError,
} from "@/features/organizations/organization-conflict";
import {
  reparentAdditionalOrganizationReferences,
  type OrganizationMergeTransaction,
} from "@/features/organizations/organization-merge-additional-references";
import {
  lockOrganizationFamilyMutationSnapshot,
  lockOrganizationFamilyReviewDomain,
} from "@/features/organizations/organization-family-lock";
export { lockOrganizationFamilyReviewDomain } from "@/features/organizations/organization-family-lock";

export type OrganizationPerson = {
  id: string;
  name: string;
  role: string | null;
  isPrimary: boolean;
  phone: string | null;
  email: string | null;
};
export type OrganizationContact = OrganizationPerson;

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
  placeType: string | null;
  region: string | null;
  hasPhone: boolean;
  hasEmail: boolean;
  hasFollowUp: boolean;
  hasBooking: boolean;
  hasLocations: boolean;
  showMembers: boolean;
  /** When true, consolidated source profiles are included in results. Defaults to false. */
  includeRetired: boolean;
  page: number;
  pageSize: number;
};

export type ProfileParentContext =
  | { kind: "event_family"; id: string; name: string }
  | { kind: "organization_group"; id: string; name: string }
  | null;

export type MatchedOrganizationLocation = {
  id: string;
  label: string;
  city: string | null;
  region: string | null;
};

export type OrganizationListRecord = Omit<
  OrganizationSummary,
  "contacts" | "bookings"
> & {
  contactCount: number;
  bookingCount: number;
  city: string | null;
  region: string | null;
  primaryContactName: string | null;
  locationCount: number;
  /** Present when the search matched via an organization_locations record rather than the org's top-level fields. */
  matchedLocation: MatchedOrganizationLocation | null;
  parentContext: ProfileParentContext;
  effectiveEventDate: EffectiveEventDate | null;
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

export function hasManualOrganizationMembershipConflict(
  records: { id: string; parentOrganizationId: string | null }[],
  candidateIds: string[],
): boolean {
  const candidates = new Set(candidateIds);
  return records.some((record) =>
    candidates.has(record.id)
    && Boolean(record.parentOrganizationId)
    && candidates.has(record.parentOrganizationId!),
  );
}

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

export type OrganizationFamilyReviewInput = {
  action: "not_related";
  candidateIds: string[];
};

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

  const outcome = await reconcileCapacityFacts(database, "canonical-merge",async (transaction) => {
    await lockOrganizationFamilyMutationSnapshot(transaction);
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
      throw new OrganizationConflictError(
        "This organization family changed. Refresh the review list and try again.",
      );
    }

    const standaloneRecords = await transaction
      .select()
      .from(organizations)
      .where(isNull(organizations.consolidatedIntoId))
      .orderBy(asc(organizations.id))
      .for("update");
    const candidatesById = new Map(
      standaloneRecords.map((organization) => [organization.id, organization]),
    );
    if (!candidateIds.every((id) => candidatesById.has(id))) {
      await transaction
        .delete(organizationFamilyReviews)
        .where(eq(organizationFamilyReviews.groupKey, groupKey));
      return "stale" as const;
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
      return "stale" as const;
    }

    await transaction
      .update(organizationFamilyReviews)
      .set({
        candidateIds,
        evidence: current.evidence,
        status: "not_related",
        updatedAt: changedAt,
      })
      .where(eq(organizationFamilyReviews.groupKey, groupKey));
    return "applied" as const;
  }, { isolationLevel: "read committed" });

  if (outcome === "stale") {
    throw new OrganizationConflictError(
      "This organization family changed. Refresh the review list and try again.",
    );
  }
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
type RepositoryTransaction = Parameters<
  Parameters<DrizzleDatabase["transaction"]>[0]
>[0];

const organizationMergeFamilyConflictMessage =
  "These profiles may be locations of the same organization. Review the location group before merging.";

async function revalidateOrganizationsMergeable(
  transaction: RepositoryTransaction,
  ids: string[],
): Promise<"mergeable" | "family_conflict"> {
  const selectedIds = [...new Set(ids)].sort((left, right) =>
    left.localeCompare(right, "en-US"),
  );
  const selectedIdSet = new Set(selectedIds);

  await lockOrganizationFamilyMutationSnapshot(transaction);
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

  // The whole organization set is locked in one deterministic order. Family
  // proposals must be compared with the current complete discovery bucket, not
  // only the IDs stored in an older proposal.
  const lockedOrganizations = await transaction
    .select()
    .from(organizations)
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
    throw new OrganizationConflictError(
      "A selected organization profile no longer exists.",
    );
  }

  if (selectedOrganizations.some((organization) => organization.consolidatedIntoId !== null)) {
    throw new OrganizationConflictError(organizationMergeFamilyConflictMessage);
  }

  if (!relevantProposals.length) return "mergeable";

  const standaloneRecords = lockedOrganizations.filter(
    (organization) => organization.consolidatedIntoId === null,
  );
  const currentGroups = await discoverOrganizationFamilyCandidatesFromDatabase(
    transaction,
    standaloneRecords,
  );

  for (const proposal of relevantProposals) {
    const isCurrent = currentGroups.some(
      (group) =>
        group.groupKey === proposal.groupKey &&
        group.candidateIds.length === proposal.candidateIds.length &&
        group.candidateIds.every(
          (id, index) => id === proposal.candidateIds[index],
        ),
    );
    if (isCurrent) return "family_conflict";

    await transaction
      .delete(organizationFamilyReviews)
      .where(eq(organizationFamilyReviews.groupKey, proposal.groupKey));

    const proposalIdSet = new Set(proposal.candidateIds);
    const replacements = currentGroups.filter(
      (group) =>
        group.groupKey &&
        group.candidateIds.some((id) => proposalIdSet.has(id)),
    );
    if (replacements.length) {
      await transaction
        .insert(organizationFamilyReviews)
        .values(replacements.map((group) => ({
          groupKey: group.groupKey!,
          candidateIds: group.candidateIds,
          status: "proposed" as const,
          evidence: group.evidence,
        })))
        .onConflictDoNothing({ target: organizationFamilyReviews.groupKey });
      return "family_conflict";
    }
  }

  return "mergeable";
}

export async function assertOrganizationsMergeable(
  transaction: OrganizationMergeTransaction,
  ids: string[],
): Promise<void> {
  if (await revalidateOrganizationsMergeable(transaction, ids) === "family_conflict") {
    throw new OrganizationConflictError(organizationMergeFamilyConflictMessage);
  }
}

export async function persistProposedOrganizationFamilies(
  database: Pick<DrizzleDatabase, "transaction">,
  proposals: OrganizationFamilyCandidateGroup[],
): Promise<void> {
  const eligibleProposals = proposals
    .filter((proposal) => proposal.groupKey && proposal.candidateIds.length >= 2)
    .toSorted((left, right) =>
      left.groupKey!.localeCompare(right.groupKey!, "en-US"),
    );
  if (!eligibleProposals.length) return;

  await reconcileCapacityFacts(database, "canonical-merge",async (transaction) => {
    await lockOrganizationFamilyMutationSnapshot(transaction);
    await transaction
      .insert(organizationFamilyReviews)
      .values(eligibleProposals.map((proposal) => ({
        groupKey: proposal.groupKey!,
        candidateIds: proposal.candidateIds,
        status: "proposed" as const,
        evidence: proposal.evidence,
      })))
      .onConflictDoNothing({ target: organizationFamilyReviews.groupKey });

    const proposalKeys = eligibleProposals.map((proposal) => proposal.groupKey!);
    const lockedReviews = await transaction
      .select({
        groupKey: organizationFamilyReviews.groupKey,
        candidateIds: organizationFamilyReviews.candidateIds,
        status: organizationFamilyReviews.status,
      })
      .from(organizationFamilyReviews)
      .where(inArray(organizationFamilyReviews.groupKey, proposalKeys))
      .orderBy(asc(organizationFamilyReviews.groupKey))
      .for("update");
    const proposalByKey = new Map(
      eligibleProposals.map((proposal) => [proposal.groupKey!, proposal]),
    );
    const activeProposals = lockedReviews.flatMap((review) => {
      const proposal = proposalByKey.get(review.groupKey);
      return review.status === "proposed" &&
        proposal &&
        review.candidateIds.length === proposal.candidateIds.length &&
        review.candidateIds.every(
          (id, index) => id === proposal.candidateIds[index],
        )
        ? [proposal]
        : [];
    });
    if (!activeProposals.length) return;

    // Rebuild the complete discovery set only after the table/evidence locks are
    // held. This closes the gap where a concurrent third location could be
    // omitted from an older A/B proposal snapshot.
    const standaloneRecords = await transaction
      .select()
      .from(organizations)
      .where(isNull(organizations.consolidatedIntoId))
      .orderBy(asc(organizations.id));
    const currentGroups = await discoverOrganizationFamilyCandidatesFromDatabase(
      transaction,
      standaloneRecords,
    );
    const activeCandidateIds = new Set(
      activeProposals.flatMap((proposal) => proposal.candidateIds),
    );
    const currentRelevantGroups = currentGroups.filter(
      (group) =>
        group.groupKey &&
        group.candidateIds.some((candidateId) =>
          activeCandidateIds.has(candidateId),
        ),
    );
    const currentByKey = new Map(
      currentRelevantGroups.map((group) => [group.groupKey!, group]),
    );
    const staleKeys = activeProposals
      .filter((proposal) => {
        const current = currentByKey.get(proposal.groupKey!);
        return (
          !current ||
          current.candidateIds.length !== proposal.candidateIds.length ||
          !current.candidateIds.every(
            (id, index) => id === proposal.candidateIds[index],
          )
        );
      })
      .map((proposal) => proposal.groupKey!);

    if (staleKeys.length) {
      await transaction
        .delete(organizationFamilyReviews)
        .where(and(
          eq(organizationFamilyReviews.status, "proposed"),
          inArray(organizationFamilyReviews.groupKey, staleKeys),
        ));

      if (currentRelevantGroups.length) {
        await transaction
          .insert(organizationFamilyReviews)
          .values(currentRelevantGroups.map((group) => ({
            groupKey: group.groupKey!,
            candidateIds: group.candidateIds,
            status: "proposed" as const,
            evidence: group.evidence,
          })))
          .onConflictDoNothing({ target: organizationFamilyReviews.groupKey });
      }
    }
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

export function buildOrganizationListCondition(
  query: OrganizationListQuery,
  options: { includeEventFamilyMembers?: boolean } = {},
): SQL | undefined {
  const pattern = `%${query.search}%`;

  // Consolidated source profiles are hidden by default.
  const notRetiredCondition =
    query.includeRetired || query.showMembers || Boolean(query.search)
      ? undefined
      : isNull(organizations.consolidatedIntoId);

  const searchCondition = query.search
    ? sql`(
        ${organizations.name} ilike ${pattern}
        or ${organizations.city} ilike ${pattern}
        or ${organizations.phone} ilike ${pattern}
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
          from ${organizationLocations} as loc
          where loc.organization_id = ${organizations.id}
            and (
              loc.label ilike ${pattern}
              or loc.venue_name ilike ${pattern}
              or loc.city ilike ${pattern}
              or loc.region ilike ${pattern}
              or loc.postal_code ilike ${pattern}
              or loc.address_1 ilike ${pattern}
              or loc.website ilike ${pattern}
              or loc.phone ilike ${pattern}
              or loc.email ilike ${pattern}
              or exists (
                select 1
                from ${contacts} as loc_contact
                where loc_contact.organization_location_id = loc.id
                  and (
                    loc_contact.first_name ilike ${pattern}
                    or loc_contact.last_name ilike ${pattern}
                    or concat_ws(' ', loc_contact.first_name, loc_contact.last_name) ilike ${pattern}
                    or loc_contact.phone ilike ${pattern}
                    or loc_contact.email ilike ${pattern}
                  )
              )
            )
        )
      )`
    : undefined;

  const lastResortCondition =
    query.lastResort === "only" ? eq(organizations.lastResort, true) : undefined;
  const travelLegCondition = query.travelLegId
    ? sql`exists (select 1 from ${bookings} where ${bookings.organizationId} = ${organizations.id} and ${bookings.travelLegId} = ${query.travelLegId})`
    : undefined;
  const typeCondition = query.placeType
    ? sql`${organizations.placeType} = ${query.placeType}`
    : undefined;
  const regionCondition = query.region
    ? sql`lower(${organizations.region}) = lower(${query.region})`
    : undefined;
  const phoneCondition = query.hasPhone
    ? sql`exists (select 1 from ${organizationContacts} oc inner join ${contacts} c on c.id = oc.contact_id where oc.organization_id = ${organizations.id} and oc.active and c.phone is not null and btrim(c.phone) <> '')`
    : undefined;
  const emailCondition = query.hasEmail
    ? sql`exists (select 1 from ${organizationContacts} oc inner join ${contacts} c on c.id = oc.contact_id where oc.organization_id = ${organizations.id} and oc.active and c.email is not null and btrim(c.email) <> '')`
    : undefined;
  const followUpCondition = query.hasFollowUp
    ? sql`exists (select 1 from ${followUps} f where f.organization_id = ${organizations.id} or f.contact_id in (select oc.contact_id from ${organizationContacts} oc where oc.organization_id = ${organizations.id} and oc.active))`
    : undefined;
  const bookingCondition = query.hasBooking
    ? sql`exists (select 1 from ${bookings} b where b.organization_id = ${organizations.id})`
    : undefined;
  const locationCondition = query.hasLocations
    ? sql`exists (select 1 from ${organizationLocations} l where l.organization_id = ${organizations.id})`
    : undefined;
  const familyMemberCondition =
    options.includeEventFamilyMembers || query.showMembers || Boolean(query.search)
      ? undefined
      : sql`not exists (select 1 from ${eventFamilyMembers} efm where efm.organization_id = ${organizations.id})`;

  return and(
    searchCondition,
    notRetiredCondition,
    lastResortCondition,
    travelLegCondition,
    typeCondition,
    regionCondition,
    phoneCondition,
    emailCondition,
    followUpCondition,
    bookingCondition,
    locationCondition,
    familyMemberCondition,
  ) ?? undefined;
}

export function buildOrganizationListOrderBy(
  query: OrganizationListQuery,
): SQL[] {
  return query.search
    ? [
        sql`case when lower(${organizations.name}) = lower(${query.search}) then 0 else 1 end`,
        asc(organizations.name),
        asc(organizations.id),
      ]
    : [asc(organizations.name), asc(organizations.id)];
}

/** Candidate groups are intentionally name-based; location gaps are common in imported profiles. */
export function duplicateOrganizationGroupsQuery() {
  return sql`
    SELECT
      lower(regexp_replace(btrim(name), '\\s+', ' ', 'g')) AS normalized_name,
      min(lower(trim(coalesce(city, '')))) AS normalized_city,
      min(lower(trim(coalesce(region, '')))) AS normalized_region,
      array_agg(id ORDER BY created_at ASC) AS ids
    FROM organizations AS duplicate_candidate
    WHERE consolidated_into_id IS NULL
    GROUP BY 1
    HAVING count(*) > 1
    ORDER BY lower(regexp_replace(btrim(name), '\\s+', ' ', 'g'))
  `;
}

export class DrizzleOrganizationRepository implements OrganizationRepository {
  constructor(private readonly database: DrizzleDatabase) {}

  async setLastResort(
    input: SetLastResortInput,
    changedAt: Date,
  ): Promise<boolean> {
    return reconcileCapacityFacts(this.database, "canonical-merge",async (transaction) => {
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

    const [organizationPeople, organizationBookings] = await Promise.all([
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
    ]);

    return {
      id: organization.id,
      name: organization.name,
      lastResort: organization.lastResort,
      lastResortReason: organization.lastResortReason,
      lastResortChangedAt: organization.lastResortChangedAt,
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
    const parentIds = [...new Set(organizationRecords.map((organization) => organization.consolidatedIntoId).filter((id): id is string => Boolean(id)))];
    const parentRows = parentIds.length
      ? await this.database.select({ id: organizations.id, name: organizations.name }).from(organizations).where(inArray(organizations.id, parentIds))
      : [];
    const parentNameById = new Map(parentRows.map((row) => [row.id, row.name]));
    const locationSearchPattern = query.search ? `%${query.search}%` : null;
    const [
      contactCounts,
      bookingCounts,
      primaryContacts,
      locationCounts,
      matchedLocationRows,
      dateBookings,
      activeDateFacts,
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
      this.database
        .select({
          organizationId: organizationLocations.organizationId,
          value: count(),
        })
        .from(organizationLocations)
        .where(inArray(organizationLocations.organizationId, organizationIds))
        .groupBy(organizationLocations.organizationId),
      // Find the first organization_location that matched the search term, per org.
      // This powers the "via [location]" context shown in search results.
      locationSearchPattern
        ? this.database
            .select({
              organizationId: organizationLocations.organizationId,
              id: organizationLocations.id,
              label: organizationLocations.label,
              city: organizationLocations.city,
              region: organizationLocations.region,
            })
            .from(organizationLocations)
            .where(
              and(
                inArray(organizationLocations.organizationId, organizationIds),
                sql`(
                  ${organizationLocations.label} ilike ${locationSearchPattern}
                  or ${organizationLocations.venueName} ilike ${locationSearchPattern}
                  or ${organizationLocations.city} ilike ${locationSearchPattern}
                  or ${organizationLocations.region} ilike ${locationSearchPattern}
                  or ${organizationLocations.postalCode} ilike ${locationSearchPattern}
                  or ${organizationLocations.address1} ilike ${locationSearchPattern}
                  or ${organizationLocations.website} ilike ${locationSearchPattern}
                  or ${organizationLocations.phone} ilike ${locationSearchPattern}
                  or ${organizationLocations.email} ilike ${locationSearchPattern}
                  or exists (
                    select 1 from ${contacts} as loc_contact
                    where loc_contact.organization_location_id = ${organizationLocations.id}
                      and (
                        loc_contact.first_name ilike ${locationSearchPattern}
                        or loc_contact.last_name ilike ${locationSearchPattern}
                        or concat_ws(' ', loc_contact.first_name, loc_contact.last_name) ilike ${locationSearchPattern}
                        or loc_contact.phone ilike ${locationSearchPattern}
                        or loc_contact.email ilike ${locationSearchPattern}
                      )
                  )
                )`,
              ),
            )
        : Promise.resolve([] as { organizationId: string; id: string; label: string; city: string | null; region: string | null }[]),
      this.database
        .select({
          id: bookings.id,
          organizationId: bookings.organizationId,
          startsAt: bookings.startsAt,
          endsAt: bookings.endsAt,
          status: bookings.status,
        })
        .from(bookings)
        .where(inArray(bookings.organizationId, organizationIds)),
      this.database
        .select()
        .from(eventDateFacts)
        .where(and(
          inArray(eventDateFacts.organizationId, organizationIds),
          eq(eventDateFacts.active, true),
        )),
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
    const locationCountByOrganization = new Map(
      locationCounts.map((record) => [record.organizationId, record.value]),
    );
    const bookingsByOrganization = new Map<string, typeof dateBookings>();
    for (const booking of dateBookings) {
      if (!booking.organizationId) continue;
      const rows = bookingsByOrganization.get(booking.organizationId) ?? [];
      rows.push(booking);
      bookingsByOrganization.set(booking.organizationId, rows);
    }
    const factsByOrganization = new Map<string, typeof activeDateFacts>();
    for (const fact of activeDateFacts) {
      const rows = factsByOrganization.get(fact.organizationId) ?? [];
      rows.push(fact);
      factsByOrganization.set(fact.organizationId, rows);
    }
    const today = new Date().toISOString().slice(0, 10);
    // Take the first matched location per organization (ORDER BY is not guaranteed, but any one is fine).
    const matchedLocationByOrganization = new Map<string, MatchedOrganizationLocation>();
    for (const row of matchedLocationRows) {
      if (!matchedLocationByOrganization.has(row.organizationId)) {
        matchedLocationByOrganization.set(row.organizationId, {
          id: row.id,
          label: row.label,
          city: row.city,
          region: row.region,
        });
      }
    }

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
        locationCount: locationCountByOrganization.get(organization.id) ?? 0,
        matchedLocation: matchedLocationByOrganization.get(organization.id) ?? null,
        parentContext: organization.consolidatedIntoId
          ? { kind: "organization_group" as const, id: organization.consolidatedIntoId, name: parentNameById.get(organization.consolidatedIntoId) ?? "Parent profile" }
          : null,
        effectiveEventDate: resolveEffectiveEventDate({
          today,
          bookings: (bookingsByOrganization.get(organization.id) ?? []).map((booking) => ({
            id: booking.id,
            startsOn: booking.startsAt?.toISOString().slice(0, 10) ?? null,
            endsOn: booking.endsAt?.toISOString().slice(0, 10) ?? null,
            status: booking.status,
          })),
          facts: (factsByOrganization.get(organization.id) ?? []).map((fact) => ({
            id: fact.id,
            startsOn: fact.startsOn,
            endsOn: fact.endsOn,
            status: fact.status,
            active: fact.active,
          })),
        }),
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
        .where(isNull(organizations.consolidatedIntoId))
        .orderBy(asc(organizations.id)),
    ]);

    const discoveredFamilies =
      await discoverOrganizationFamilyCandidatesFromDatabase(
        this.database,
        familyRecords,
      );
    const reviews = await this.database
      .select()
      .from(organizationFamilyReviews);
    const reviewByKey = new Map(reviews.map((review) => [review.groupKey, review]));
    const reviewGroups = partitionOrganizationReviewGroups(
      groupRows.rows,
      discoveredFamilies,
      reviews,
    ).filter(
      (group) => !hasManualOrganizationMembershipConflict(familyRecords, group.candidateIds),
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
    const [contactCounts, bookingCounts, primaryContacts, locationCounts] =
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
        this.database
          .select({ organizationId: organizationLocations.organizationId, value: count() })
          .from(organizationLocations)
          .where(inArray(organizationLocations.organizationId, organizationIds))
          .groupBy(organizationLocations.organizationId),
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
    const locationCountByOrganization = new Map(
      locationCounts.map((record) => [record.organizationId, record.value]),
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
            locationCount: locationCountByOrganization.get(organization.id) ?? 0,
            matchedLocation: null,
            parentContext: null,
            effectiveEventDate: null,
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

  async mergeOrganizations(
    primaryId: string,
    duplicateIds: string[],
    outerTransaction?: OrganizationMergeTransaction,
  ): Promise<void> {
    if (!duplicateIds.length) return;

    const merge = async (tx: OrganizationMergeTransaction) => {
      const guard = await revalidateOrganizationsMergeable(
        tx,
        [primaryId, ...duplicateIds],
      );
      if (guard === "family_conflict") return "family_conflict" as const;
      const now = new Date();

      for (const dupId of duplicateIds) {
        // Step 1: Create organization_contacts entries on the primary for every
        // contact currently belonging to the duplicate. This MUST happen before
        // updating contacts.organization_id because the schema enforces a
        // composite FK: contacts(organization_id, id) 
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

        // Step 2: Move saved locations to the surviving organization first.
        // Contacts can retain organization_location_id while their organization_id
        // changes only when that location already belongs to the survivor. The DB
        // consistency trigger enforces this relationship on every contact update.
        await tx.update(organizationLocations)
          .set({ organizationId: primaryId, updatedAt: now })
          .where(eq(organizationLocations.organizationId, dupId));

        // Step 3: Re-parent contacts -- now safe because every contact has both
        // a matching organization_contacts row and, when present, a saved location
        // that already belongs to primaryId.
        await tx.update(contacts)
          .set({ organizationId: primaryId, updatedAt: now })
          .where(eq(contacts.organizationId, dupId));

        // Step 4: Remove the now-redundant organization_contacts rows for the
        // duplicate. Contacts no longer point to dupId, so no FK is violated.
        await tx.delete(organizationContacts)
          .where(eq(organizationContacts.organizationId, dupId));

        // Step 5: Re-parent bookings
        await tx.update(bookings)
          .set({ organizationId: primaryId, updatedAt: now })
          .where(eq(bookings.organizationId, dupId));

        // Step 6: Re-parent follow_ups
        await tx.update(followUps)
          .set({ organizationId: primaryId })
          .where(eq(followUps.organizationId, dupId));

        // Step 7: Re-parent activities
        await tx.update(activities)
          .set({ organizationId: primaryId, updatedAt: now })
          .where(eq(activities.organizationId, dupId));

        // Step 8: Re-parent call_sessions
        await tx.update(callSessions)
          .set({ organizationId: primaryId })
          .where(eq(callSessions.organizationId, dupId));

        // Step 9: Re-parent act_external_links.
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

        // Step 10: Re-parent act_migration_records matched/applied entity pointers
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

        // Step 11: A location can also retain the duplicate as its historical
        // consolidation source. That FK is RESTRICT as well. The source profile
        // is being deleted by this plain duplicate merge, so clear that stale
        // provenance pointer while preserving the location record itself.
        await tx.update(organizationLocations)
          .set({ consolidationSourceOrgId: null, updatedAt: now })
          .where(eq(organizationLocations.consolidationSourceOrgId, dupId));

        // Step 12: If the duplicate had already been used as a canonical parent
        // for retired location profiles, keep those redirects intact by pointing
        // the retired profiles at the organization that survives this merge.
        await tx.update(organizations)
          .set({ consolidatedIntoId: primaryId, updatedAt: now })
          .where(eq(organizations.consolidatedIntoId, dupId));

        // Step 13: Preserve newer CRM, communication, research, and history rows.
        await reparentAdditionalOrganizationReferences(tx, primaryId, dupId);

        // Step 14: Delete the now-empty duplicate
        await tx.delete(organizations).where(eq(organizations.id, dupId));
      }
      return "merged" as const;
    };
    const outcome = outerTransaction
      ? await merge(outerTransaction)
      : await reconcileCapacityFacts(this.database, "canonical-merge",merge);

    if (outcome === "family_conflict") {
      throw new OrganizationConflictError(organizationMergeFamilyConflictMessage);
    }
  }
}
