import type {
  ActMigrationProposal,
  ActSourceEntityType,
  LocalMigrationCandidateSnapshot,
  LocalPersonCandidate,
  LocalPlaceCandidate,
  MigrationIssueCode,
  MigrationPreviewState,
  MigrationReviewState,
  MigrationTargetEntityType,
} from "@/features/act-migration/migration-types";
import { migrationTargetRank } from "@/features/act-migration/migration-types";
import type { FinalizedSourceSnapshot } from "@/features/act-migration/snapshot-repository";
import type {
  NormalizedCompany,
  NormalizedContact,
  NormalizedGroup,
  NormalizedOpportunity,
  NormalizedRelationship,
  StagedSourceItem,
} from "@/features/act-migration/source-parser";
import { normalizeMatchingText } from "@/features/act-migration/matching-normalization";

type Primitive = string | number | boolean | null;
type DisplaySnapshot = Record<string, Primitive>;

type ProposalDraft = Omit<ActMigrationProposal, "proposalKey"> & {
  proposalKey: string;
};

type EntityRecord<T> = StagedSourceItem & {
  sourceId: string;
  errorCode: null;
  normalizedSnapshot: T & Record<string, unknown>;
};

function isEntityRecord<T>(
  record: StagedSourceItem | undefined,
): record is EntityRecord<T> {
  return Boolean(record && !record.errorCode && record.sourceId);
}

function bySourceId<T>(
  records: readonly StagedSourceItem[],
  streamType: ActSourceEntityType,
) {
  return new Map(
    records
      .filter(
        (record): record is EntityRecord<T> =>
          record.streamType === streamType && isEntityRecord<T>(record),
      )
      .map((record) => [record.sourceId, record]),
  );
}

function relationships(
  records: readonly StagedSourceItem[],
  streamType:
    | "company_contact"
    | "opportunity_company"
    | "opportunity_contact"
    | "group_contact",
) {
  return records.filter(
    (record): record is EntityRecord<NormalizedRelationship> =>
      record.streamType === streamType &&
      isEntityRecord<NormalizedRelationship>(record) &&
      Boolean(record.targetSourceId),
  );
}

function reviewStateFor(state: MigrationPreviewState): MigrationReviewState {
  if (state === "matched_unchanged" || state === "error") {
    return "not_required";
  }
  if (state === "ignored") return "ignored";
  return "pending";
}

function proposal(input: {
  proposalKey: string;
  state: MigrationPreviewState;
  targetEntityType: MigrationTargetEntityType;
  sourceRecordKeys: readonly string[];
  candidateLocalIds?: readonly string[];
  proposedLocalId?: string | null;
  proposedPrimarySourceId?: string | null;
  matchReason: string;
  issueCode?: MigrationIssueCode | null;
  dependencyProposalKeys?: readonly string[];
  displaySnapshot: DisplaySnapshot;
}): ProposalDraft {
  return {
    proposalKey: input.proposalKey,
    state: input.state,
    reviewState: reviewStateFor(input.state),
    targetEntityType: input.targetEntityType,
    sourceRecordKeys: [...input.sourceRecordKeys].toSorted(),
    candidateLocalIds: [...(input.candidateLocalIds ?? [])].toSorted(),
    proposedLocalId: input.proposedLocalId ?? null,
    proposedPrimarySourceId: input.proposedPrimarySourceId ?? null,
    matchReason: input.matchReason,
    issueCode: input.issueCode ?? null,
    dependencyProposalKeys: [
      ...(input.dependencyProposalKeys ?? []),
    ].toSorted(),
    displaySnapshot: input.displaySnapshot,
  };
}

function sameValues(
  left: Record<string, string | null>,
  right: Record<string, string | null>,
) {
  return Object.keys(left).every((key) => left[key] === right[key]);
}

function placeDisplay(company: NormalizedCompany): DisplaySnapshot {
  return {
    name: company.displayName,
    placeType: "other",
    actIndustry: company.industry,
    phone: company.phone,
    address1: company.address1,
    address2: company.address2,
    city: company.city,
    region: company.region,
    postalCode: company.postalCode,
    website: company.website,
  };
}

function placeComparableFromSource(company: NormalizedCompany) {
  return {
    name: company.normalizedName,
    actIndustry: normalizeMatchingText(company.industry),
    phone: company.normalizedPhone,
    address1: normalizeMatchingText(company.address1),
    address2: normalizeMatchingText(company.address2),
    city: company.normalizedCity,
    region: company.normalizedRegion,
    postalCode: normalizeMatchingText(company.postalCode),
    website: company.normalizedWebsiteHost,
  };
}

function placeComparableFromLocal(place: LocalPlaceCandidate) {
  return {
    name: place.normalizedName,
    actIndustry: normalizeMatchingText(place.actIndustry),
    phone: place.normalizedPhone,
    address1: normalizeMatchingText(place.address1),
    address2: normalizeMatchingText(place.address2),
    city: place.normalizedCity,
    region: place.normalizedRegion,
    postalCode: normalizeMatchingText(place.postalCode),
    website: place.normalizedWebsiteHost,
  };
}

function fillCompanyFromContact(
  original: NormalizedCompany,
  contacts: readonly EntityRecord<NormalizedContact>[],
) {
  const merged = { ...original };
  let ignoredContactEmail: string | null = null;
  for (const record of contacts.toSorted((left, right) =>
    left.sourceKey.localeCompare(right.sourceKey),
  )) {
    const contact = record.normalizedSnapshot;
    merged.phone ??= contact.phone;
    merged.normalizedPhone ??= contact.normalizedPhone;
    merged.address1 ??= contact.address1;
    merged.address2 ??= contact.address2;
    merged.city ??= contact.city;
    merged.region ??= contact.region;
    merged.postalCode ??= contact.postalCode;
    merged.normalizedCity ??= contact.normalizedCity;
    merged.normalizedRegion ??= contact.normalizedRegion;
    ignoredContactEmail ??= contact.email;
  }
  return { merged, ignoredContactEmail };
}

function personDisplay(contact: NormalizedContact): DisplaySnapshot {
  return {
    firstName: contact.firstName,
    lastName: contact.lastName,
    displayName: contact.displayName,
    email: contact.email,
    phone: contact.phone,
    jobTitle: contact.jobTitle,
    address1: contact.address1,
    address2: contact.address2,
    city: contact.city,
    region: contact.region,
    postalCode: contact.postalCode,
  };
}

function personComparableFromSource(contact: NormalizedContact) {
  return {
    name: contact.normalizedName,
    email: contact.normalizedEmail,
    phone: contact.normalizedPhone,
    jobTitle: normalizeMatchingText(contact.jobTitle),
    address1: normalizeMatchingText(contact.address1),
    address2: normalizeMatchingText(contact.address2),
    city: contact.normalizedCity,
    region: contact.normalizedRegion,
    postalCode: normalizeMatchingText(contact.postalCode),
  };
}

function personComparableFromLocal(person: LocalPersonCandidate) {
  return {
    name: person.normalizedName,
    email: person.normalizedEmail,
    phone: person.normalizedPhone,
    jobTitle: normalizeMatchingText(person.jobTitle),
    address1: normalizeMatchingText(person.address1),
    address2: normalizeMatchingText(person.address2),
    city: normalizeMatchingText(person.city),
    region: normalizeMatchingText(person.region),
    postalCode: normalizeMatchingText(person.postalCode),
  };
}

function targetForError(streamType: StagedSourceItem["streamType"]) {
  switch (streamType) {
    case "company":
      return "organization";
    case "contact":
      return "contact";
    case "opportunity":
      return "booking";
    case "company_contact":
      return "organization_contact";
    case "opportunity_contact":
      return "booking_contact";
    case "group":
      return "calling_list";
    case "group_contact":
      return "calling_list_member";
    case "opportunity_company":
      return "booking";
  }
}

function stableLink(
  local: LocalMigrationCandidateSnapshot,
  sourceEntityType: ActSourceEntityType,
  actRecordId: string,
) {
  return local.externalLinks.find(
    (link) =>
      link.sourceEntityType === sourceEntityType &&
      link.actRecordId === actRecordId,
  );
}

function compatibleName(
  sourceName: string | null,
  localName: string,
) {
  return sourceName !== null && sourceName === localName;
}

export function buildMigrationProposals(input: {
  source: FinalizedSourceSnapshot;
  local: LocalMigrationCandidateSnapshot;
}): readonly ActMigrationProposal[] {
  const records = [...input.source.records].toSorted((left, right) =>
    left.sourceKey.localeCompare(right.sourceKey),
  );
  const proposals: ProposalDraft[] = [];
  const owned = new Set<string>();
  const proposalBySourceKey = new Map<string, ProposalDraft>();

  function add(value: ProposalDraft) {
    for (const sourceKey of value.sourceRecordKeys) {
      if (owned.has(sourceKey)) {
        throw new Error(`Act migration source key was proposed twice: ${sourceKey}`);
      }
      owned.add(sourceKey);
      proposalBySourceKey.set(sourceKey, value);
    }
    proposals.push(value);
  }

  for (const record of records.filter(({ errorCode }) => errorCode !== null)) {
    add(
      proposal({
        proposalKey: `error:${record.sourceKey}`,
        state: "error",
        targetEntityType: targetForError(record.streamType),
        sourceRecordKeys: [record.sourceKey],
        matchReason: record.errorCode ?? "source_record_error",
        issueCode:
          record.errorCode === "duplicate_source_id_conflict"
            ? "duplicate_source_id_conflict"
            : "source_record_error",
        displaySnapshot: {
          sourceKey: record.sourceKey,
          errorCode: record.errorCode,
        },
      }),
    );
  }

  const companies = bySourceId<NormalizedCompany>(records, "company");
  const contacts = bySourceId<NormalizedContact>(records, "contact");
  const opportunities = bySourceId<NormalizedOpportunity>(
    records,
    "opportunity",
  );
  const groups = bySourceId<NormalizedGroup>(records, "group");
  const companyContactEdges = relationships(records, "company_contact");
  const opportunityCompanyEdges = relationships(
    records,
    "opportunity_company",
  );
  const opportunityContactEdges = relationships(
    records,
    "opportunity_contact",
  );
  const groupContactEdges = relationships(records, "group_contact");
  const localPlaces = new Map(input.local.places.map((place) => [place.id, place]));
  const localPeople = new Map(input.local.people.map((person) => [person.id, person]));
  const localBookings = new Map(
    input.local.bookings.map((booking) => [booking.id, booking]),
  );

  const personEligible = new Map<string, boolean>();
  for (const [sourceId, record] of contacts) {
    const link = stableLink(input.local, "contact", sourceId);
    personEligible.set(
      sourceId,
      record.normalizedSnapshot.personCandidate ||
        Boolean(link && localPeople.has(link.entityId)),
    );
  }

  const foldedContactsByCompany = new Map<
    string,
    EntityRecord<NormalizedContact>[]
  >();
  const foldedEdgesByCompany = new Map<
    string,
    EntityRecord<NormalizedRelationship>[]
  >();
  const unresolvedCompanyOnly: {
    contact: EntityRecord<NormalizedContact>;
    edges: EntityRecord<NormalizedRelationship>[];
  }[] = [];

  for (const contact of contacts.values()) {
    if (personEligible.get(contact.sourceId)) continue;
    const edges = companyContactEdges.filter(
      ({ targetSourceId }) => targetSourceId === contact.sourceId,
    );
    if (edges.length === 1 && companies.has(edges[0]!.sourceId)) {
      const companyId = edges[0]!.sourceId;
      foldedContactsByCompany.set(companyId, [
        ...(foldedContactsByCompany.get(companyId) ?? []),
        contact,
      ]);
      foldedEdgesByCompany.set(companyId, [
        ...(foldedEdgesByCompany.get(companyId) ?? []),
        edges[0]!,
      ]);
    } else {
      unresolvedCompanyOnly.push({ contact, edges });
    }
  }

  for (const company of companies.values()) {
    const foldedContacts = foldedContactsByCompany.get(company.sourceId) ?? [];
    const foldedEdges = foldedEdgesByCompany.get(company.sourceId) ?? [];
    const { merged, ignoredContactEmail } = fillCompanyFromContact(
      company.normalizedSnapshot,
      foldedContacts,
    );
    const sourceKeys = [
      company.sourceKey,
      ...foldedContacts.map(({ sourceKey }) => sourceKey),
      ...foldedEdges.map(({ sourceKey }) => sourceKey),
    ];
    const display: DisplaySnapshot = {
      ...placeDisplay(merged),
      ...(ignoredContactEmail ? { ignoredContactEmail } : {}),
    };
    const link = stableLink(input.local, "company", company.sourceId);
    if (link) {
      const localPlace = localPlaces.get(link.entityId);
      if (!localPlace) {
        add(
          proposal({
            proposalKey: `organization:${company.sourceKey}`,
            state: "needs_review",
            targetEntityType: "organization",
            sourceRecordKeys: sourceKeys,
            matchReason: "dangling_company_link",
            issueCode: "orphaned_external_link",
            displaySnapshot: display,
          }),
        );
        continue;
      }
      const unchanged = sameValues(
        placeComparableFromSource(merged),
        placeComparableFromLocal(localPlace),
      );
      add(
        proposal({
          proposalKey: `organization:${company.sourceKey}`,
          state: unchanged ? "matched_unchanged" : "change",
          targetEntityType: "organization",
          sourceRecordKeys: sourceKeys,
          candidateLocalIds: [localPlace.id],
          proposedLocalId: localPlace.id,
          matchReason: "stable_company_link",
          displaySnapshot: display,
        }),
      );
      continue;
    }

    const named = input.local.places.filter(
      ({ normalizedName }) =>
        merged.normalizedName !== null &&
        normalizedName === merged.normalizedName,
    );
    const locationMatches =
      merged.normalizedCity && merged.normalizedRegion
        ? named.filter(
            ({ normalizedCity, normalizedRegion }) =>
              normalizedCity === merged.normalizedCity &&
              normalizedRegion === merged.normalizedRegion,
          )
        : [];
    if (locationMatches.length === 1) {
      add(
        proposal({
          proposalKey: `organization:${company.sourceKey}`,
          state: "possible_duplicate",
          targetEntityType: "organization",
          sourceRecordKeys: sourceKeys,
          candidateLocalIds: [locationMatches[0]!.id],
          proposedLocalId: locationMatches[0]!.id,
          matchReason: "unique_name_city_region",
          displaySnapshot: display,
        }),
      );
      continue;
    }
    const verifiedMatches = named.filter(
      ({ normalizedPhone, normalizedWebsiteHost }) =>
        (merged.normalizedPhone !== null &&
          normalizedPhone === merged.normalizedPhone) ||
        (merged.normalizedWebsiteHost !== null &&
          normalizedWebsiteHost === merged.normalizedWebsiteHost),
    );
    if (verifiedMatches.length === 1) {
      add(
        proposal({
          proposalKey: `organization:${company.sourceKey}`,
          state: "possible_duplicate",
          targetEntityType: "organization",
          sourceRecordKeys: sourceKeys,
          candidateLocalIds: [verifiedMatches[0]!.id],
          proposedLocalId: verifiedMatches[0]!.id,
          matchReason: "unique_name_phone_or_website",
          displaySnapshot: display,
        }),
      );
      continue;
    }
    if (named.length > 1 || locationMatches.length > 1 || verifiedMatches.length > 1) {
      add(
        proposal({
          proposalKey: `organization:${company.sourceKey}`,
          state: "needs_review",
          targetEntityType: "organization",
          sourceRecordKeys: sourceKeys,
          candidateLocalIds: named.map(({ id }) => id),
          matchReason: "ambiguous_normalized_company_name",
          issueCode: "ambiguous_place_match",
          displaySnapshot: display,
        }),
      );
      continue;
    }
    add(
      proposal({
        proposalKey: `organization:${company.sourceKey}`,
        state: "new",
        targetEntityType: "organization",
        sourceRecordKeys: sourceKeys,
        matchReason: "no_place_candidate",
        displaySnapshot: display,
      }),
    );
  }

  for (const { contact, edges } of unresolvedCompanyOnly) {
    const dependencies = edges.flatMap((edge) => {
      const parent = proposalBySourceKey.get(
        companies.get(edge.sourceId)?.sourceKey ?? "",
      );
      return parent ? [parent.proposalKey] : [];
    });
    add(
      proposal({
        proposalKey: `organization:company-only:${contact.sourceKey}`,
        state: "needs_review",
        targetEntityType: "organization",
        sourceRecordKeys: [
          contact.sourceKey,
          ...edges.map(({ sourceKey }) => sourceKey),
        ],
        matchReason:
          edges.length === 0
            ? "company_only_contact_has_no_company"
            : "company_only_contact_parent_unresolved",
        issueCode: "company_only_contact_unresolved",
        dependencyProposalKeys: dependencies,
        displaySnapshot: {
          name: contact.normalizedSnapshot.companyName,
          contactName: contact.normalizedSnapshot.displayName,
          phone: contact.normalizedSnapshot.phone,
          address1: contact.normalizedSnapshot.address1,
          address2: contact.normalizedSnapshot.address2,
          city: contact.normalizedSnapshot.city,
          region: contact.normalizedSnapshot.region,
          postalCode: contact.normalizedSnapshot.postalCode,
          ignoredContactEmail: contact.normalizedSnapshot.email,
        },
      }),
    );
  }

  type PersonMatch = {
    record: EntityRecord<NormalizedContact>;
    groupKey: string;
    reason: string;
    candidates: string[];
    issueCode: MigrationIssueCode | null;
    stable: boolean;
  };
  const personMatches: PersonMatch[] = [];
  for (const contact of contacts.values()) {
    if (!personEligible.get(contact.sourceId)) continue;
    const normalized = contact.normalizedSnapshot;
    const link = stableLink(input.local, "contact", contact.sourceId);
    if (link && localPeople.has(link.entityId)) {
      personMatches.push({
        record: contact,
        groupKey: `local:${link.entityId}`,
        reason: "stable_contact_link",
        candidates: [link.entityId],
        issueCode: null,
        stable: true,
      });
      continue;
    }

    const compatible = input.local.people.filter(({ normalizedName }) =>
      compatibleName(normalized.normalizedName, normalizedName),
    );
    const emailMatches =
      normalized.normalizedEmail === null
        ? []
        : input.local.people.filter(
            ({ normalizedEmail }) =>
              normalizedEmail === normalized.normalizedEmail,
          );
    if (normalized.sharedEmail && emailMatches.length > 0) {
      personMatches.push({
        record: contact,
        groupKey: `source:${contact.sourceId}`,
        reason: "shared_mailbox_email_not_unique_identity",
        candidates: emailMatches.map(({ id }) => id),
        issueCode: "shared_mailbox_match_blocked",
        stable: false,
      });
      continue;
    }
    const compatibleEmailMatches =
      normalized.normalizedEmail === null
        ? []
        : compatible.filter(
            ({ normalizedEmail, sharedEmail }) =>
              !sharedEmail &&
              normalizedEmail === normalized.normalizedEmail,
          );
    if (compatibleEmailMatches.length === 1) {
      personMatches.push({
        record: contact,
        groupKey: `local:${compatibleEmailMatches[0]!.id}`,
        reason: "unique_email_compatible_name",
        candidates: [compatibleEmailMatches[0]!.id],
        issueCode: null,
        stable: false,
      });
      continue;
    }
    const phoneMatches =
      normalized.normalizedPhone === null
        ? []
        : compatible.filter(
            ({ normalizedPhone }) =>
              normalizedPhone === normalized.normalizedPhone,
          );
    if (phoneMatches.length === 1) {
      personMatches.push({
        record: contact,
        groupKey: `local:${phoneMatches[0]!.id}`,
        reason: "unique_phone_compatible_name",
        candidates: [phoneMatches[0]!.id],
        issueCode: null,
        stable: false,
      });
      continue;
    }

    const contactCompanyEdges = companyContactEdges.filter(
      ({ targetSourceId }) => targetSourceId === contact.sourceId,
    );
    const placeIds = contactCompanyEdges.flatMap((edge) => {
      const parent = companies.get(edge.sourceId);
      const parentProposal = parent
        ? proposalBySourceKey.get(parent.sourceKey)
        : undefined;
      return parentProposal?.proposedLocalId
        ? [parentProposal.proposedLocalId]
        : [];
    });
    const placeMatches = compatible.filter((person) =>
      input.local.placePeople.some(
        ({ organizationId, contactId }) =>
          placeIds.includes(organizationId) && contactId === person.id,
      ),
    );
    if (placeMatches.length === 1) {
      personMatches.push({
        record: contact,
        groupKey: `local:${placeMatches[0]!.id}`,
        reason: "unique_place_compatible_name",
        candidates: [placeMatches[0]!.id],
        issueCode: null,
        stable: false,
      });
      continue;
    }

    const ambiguous = [
      ...new Set(
        [...compatibleEmailMatches, ...phoneMatches, ...placeMatches].map(
          ({ id }) => id,
        ),
      ),
    ].toSorted();
    if (ambiguous.length > 1) {
      personMatches.push({
        record: contact,
        groupKey: `source:${contact.sourceId}`,
        reason: "ambiguous_person_candidates",
        candidates: ambiguous,
        issueCode: "ambiguous_person_match",
        stable: false,
      });
      continue;
    }

    const newIdentity =
      normalized.normalizedEmail && !normalized.sharedEmail
        ? `new:${normalized.normalizedName ?? ""}:${normalized.normalizedEmail}`
        : `source:${contact.sourceId}`;
    personMatches.push({
      record: contact,
      groupKey: newIdentity,
      reason: "no_person_candidate",
      candidates: [],
      issueCode: null,
      stable: false,
    });
  }

  const personGroups = Map.groupBy(personMatches, ({ groupKey }) => groupKey);
  for (const [groupKey, matches] of personGroups) {
    const sortedMatches = matches.toSorted((left, right) =>
      left.record.sourceKey.localeCompare(right.record.sourceKey),
    );
    const localId = groupKey.startsWith("local:")
      ? groupKey.slice("local:".length)
      : null;
    const stableMatches = sortedMatches.filter(({ stable }) => stable);
    const twoWayMatches = stableMatches.filter(({ record }) => {
      const link = stableLink(input.local, "contact", record.sourceId);
      return link?.isPrimary === true && link.syncMode === "two_way";
    });
    const sourceIds = sortedMatches.map(({ record }) => record.sourceId);
    const primarySourceId = input.local.externalLinks
      .filter(
        (link) =>
          link.entityType === "contact" &&
          link.sourceEntityType === "contact" &&
          link.entityId === localId &&
          link.isPrimary &&
          link.syncMode === "two_way" &&
          sourceIds.includes(link.actRecordId),
      )
      .map(({ actRecordId }) => actRecordId)
      .toSorted()[0];
    const authoritative =
      sortedMatches.find(
        ({ record }) => record.sourceId === primarySourceId,
      ) ??
      twoWayMatches[0] ??
      sortedMatches[0]!;
    const display = personDisplay(authoritative.record.normalizedSnapshot);
    const candidates = [
      ...new Set(sortedMatches.flatMap(({ candidates }) => candidates)),
    ].toSorted();
    const issueCode =
      sortedMatches.find(({ issueCode }) => issueCode !== null)?.issueCode ??
      null;

    if (issueCode) {
      add(
        proposal({
          proposalKey: `contact:${sortedMatches[0]!.record.sourceKey}`,
          state: "needs_review",
          targetEntityType: "contact",
          sourceRecordKeys: sortedMatches.map(({ record }) => record.sourceKey),
          candidateLocalIds: candidates,
          matchReason: authoritative.reason,
          issueCode,
          displaySnapshot: display,
        }),
      );
      continue;
    }

    if (localId) {
      const localPerson = localPeople.get(localId)!;
      const hasStable = stableMatches.length > 0;
      const hasTwoWay = twoWayMatches.length > 0;
      const unchanged =
        !hasTwoWay ||
        sameValues(
          personComparableFromSource(authoritative.record.normalizedSnapshot),
          personComparableFromLocal(localPerson),
        );
      const consolidation = sortedMatches.length > 1;
      add(
        proposal({
          proposalKey: `contact:${sortedMatches[0]!.record.sourceKey}`,
          state: hasStable
            ? unchanged
              ? "matched_unchanged"
              : "change"
            : "possible_duplicate",
          targetEntityType: "contact",
          sourceRecordKeys: sortedMatches.map(({ record }) => record.sourceKey),
          candidateLocalIds: [localId],
          proposedLocalId: localId,
          proposedPrimarySourceId:
            hasStable
              ? (primarySourceId ?? null)
              : consolidation
                ? null
                : sourceIds[0]!,
          matchReason: hasTwoWay
            ? "stable_contact_link"
            : hasStable
              ? "stable_contact_alias"
            : authoritative.reason,
          displaySnapshot: display,
        }),
      );
      continue;
    }

    const consolidation = sortedMatches.length > 1;
    add(
      proposal({
        proposalKey: `contact:${sortedMatches[0]!.record.sourceKey}`,
        state: consolidation ? "needs_review" : "new",
        targetEntityType: "contact",
        sourceRecordKeys: sortedMatches.map(({ record }) => record.sourceKey),
        proposedPrimarySourceId: consolidation ? null : sourceIds[0]!,
        matchReason: consolidation
          ? "source_person_consolidation"
          : authoritative.reason,
        issueCode: consolidation ? "ambiguous_person_match" : null,
        displaySnapshot: display,
      }),
    );
  }

  const regularCompanyEdges = companyContactEdges.filter(
    (edge) =>
      !owned.has(edge.sourceKey) &&
      personEligible.get(edge.targetSourceId ?? "") === true,
  );
  const companyRelationshipGroups = Map.groupBy(
    regularCompanyEdges,
    (edge) => {
      const company = companies.get(edge.sourceId);
      const contact = contacts.get(edge.targetSourceId ?? "");
      const placeParent = company
        ? proposalBySourceKey.get(company.sourceKey)
        : undefined;
      const personParent = contact
        ? proposalBySourceKey.get(contact.sourceKey)
        : undefined;
      return `${placeParent?.proposalKey ?? edge.sourceId}|${personParent?.proposalKey ?? edge.targetSourceId}`;
    },
  );
  for (const edges of companyRelationshipGroups.values()) {
    const first = edges[0]!;
    const company = companies.get(first.sourceId);
    const contact = contacts.get(first.targetSourceId ?? "");
    const placeParent = company
      ? proposalBySourceKey.get(company.sourceKey)
      : undefined;
    const personParent = contact
      ? proposalBySourceKey.get(contact.sourceKey)
      : undefined;
    const dependencies = [placeParent, personParent].flatMap((value) =>
      value ? [value.proposalKey] : [],
    );
    const pair =
      placeParent?.proposedLocalId && personParent?.proposedLocalId
        ? input.local.placePeople.find(
            ({ organizationId, contactId }) =>
              organizationId === placeParent.proposedLocalId &&
              contactId === personParent.proposedLocalId,
          )
        : undefined;
    const unresolved = !placeParent || !personParent;
    add(
      proposal({
        proposalKey: `organization_contact:${first.sourceKey}`,
        state: unresolved
          ? "needs_review"
          : pair
            ? pair.active
              ? "matched_unchanged"
              : "change"
            : "new_relationship",
        targetEntityType: "organization_contact",
        sourceRecordKeys: edges.map(({ sourceKey }) => sourceKey),
        proposedLocalId: null,
        matchReason: unresolved
          ? "relationship_parent_unresolved"
          : pair
            ? pair.active
              ? "existing_place_person_relationship"
              : "inactive_place_person_relationship"
            : "new_place_person_relationship",
        issueCode: unresolved ? "parent_proposal_unresolved" : null,
        dependencyProposalKeys: dependencies,
        displaySnapshot: {
          organizationId: placeParent?.proposedLocalId ?? null,
          contactId: personParent?.proposedLocalId ?? null,
          active: true,
          isPrimary: pair?.isPrimary ?? false,
          role: pair?.role ?? null,
          source: pair?.source ?? "act",
        },
      }),
    );
  }

  for (const opportunity of opportunities.values()) {
    const parentEdges = opportunityCompanyEdges.filter(
      ({ sourceId }) => sourceId === opportunity.sourceId,
    );
    const parentProposals = parentEdges.flatMap((edge) => {
      const company = companies.get(edge.targetSourceId ?? "");
      const parent = company
        ? proposalBySourceKey.get(company.sourceKey)
        : undefined;
      return parent ? [parent] : [];
    });
    const parentCompany =
      parentEdges.length === 1
        ? companies.get(parentEdges[0]!.targetSourceId ?? "")
        : undefined;
    const parentProposal = parentCompany
      ? proposalBySourceKey.get(parentCompany.sourceKey)
      : undefined;
    let issueCode: MigrationIssueCode | null = null;
    if (parentEdges.length === 0) {
      issueCode = "opportunity_place_missing";
    } else if (parentEdges.length > 1) {
      issueCode = "opportunity_place_ambiguous";
    } else if (!parentCompany || !parentProposal) {
      issueCode = "opportunity_place_errored";
    } else if (
      parentProposal.state === "needs_review" ||
      parentProposal.state === "possible_duplicate"
    ) {
      issueCode = "opportunity_place_ambiguous";
    } else if (
      !parentProposal.displaySnapshot.city ||
      !parentProposal.displaySnapshot.region
    ) {
      issueCode = "opportunity_place_location_incomplete";
    }

    const normalized = opportunity.normalizedSnapshot;
    const display: DisplaySnapshot = {
      name: normalized.displayName,
      organizationId: parentProposal?.proposedLocalId ?? null,
      primaryContactId: null,
      venueName:
        (parentProposal?.displaySnapshot.name as string | null | undefined) ??
        null,
      address1:
        (parentProposal?.displaySnapshot.address1 as
          | string
          | null
          | undefined) ?? null,
      city:
        (parentProposal?.displaySnapshot.city as
          | string
          | null
          | undefined) ?? null,
      region:
        (parentProposal?.displaySnapshot.region as
          | string
          | null
          | undefined) ?? null,
      postalCode:
        (parentProposal?.displaySnapshot.postalCode as
          | string
          | null
          | undefined) ?? null,
      startsAt: null,
      endsAt: null,
      status: "new_lead",
      probability: "possible",
      notes: null,
      sourceStatus: normalized.status,
      sourceProbability: normalized.probability,
      sourceTotal: normalized.total,
      sourceEstimatedCloseDate: normalized.estimatedCloseDate,
      sourceActualCloseDate: normalized.actualCloseDate,
      sourceStageId: normalized.stageId,
      sourceStageName: normalized.stageName,
      sourceProcessId: normalized.processId,
      sourceProcessName: normalized.processName,
    };
    const sourceKeys = [
      opportunity.sourceKey,
      ...parentEdges.map(({ sourceKey }) => sourceKey),
    ];
    const dependencyKeys = parentProposals.map(({ proposalKey }) => proposalKey);
    if (issueCode) {
      add(
        proposal({
          proposalKey: `booking:${opportunity.sourceKey}`,
          state: "needs_review",
          targetEntityType: "booking",
          sourceRecordKeys: sourceKeys,
          matchReason: issueCode,
          issueCode,
          dependencyProposalKeys: dependencyKeys,
          displaySnapshot: display,
        }),
      );
      continue;
    }

    const personEdges = opportunityContactEdges.filter(
      ({ sourceId }) => sourceId === opportunity.sourceId,
    );
    const hasResolvedPerson = personEdges.some((edge) => {
      const contact = contacts.get(edge.targetSourceId ?? "");
      return Boolean(
        contact && proposalBySourceKey.get(contact.sourceKey)?.targetEntityType ===
          "contact",
      );
    });
    const link = stableLink(input.local, "opportunity", opportunity.sourceId);
    if (link) {
      const booking = localBookings.get(link.entityId);
      if (!booking) {
        add(
          proposal({
            proposalKey: `booking:${opportunity.sourceKey}`,
            state: "needs_review",
            targetEntityType: "booking",
            sourceRecordKeys: sourceKeys,
            matchReason: "dangling_opportunity_link",
            issueCode: "orphaned_external_link",
            dependencyProposalKeys: dependencyKeys,
            displaySnapshot: display,
          }),
        );
        continue;
      }
      const unchanged =
        normalizeMatchingText(booking.name) === normalized.normalizedName &&
        normalizeMatchingText(booking.address1) ===
          normalizeMatchingText(display.address1 as string | null) &&
        normalizeMatchingText(booking.city) ===
          normalizeMatchingText(display.city as string | null) &&
        normalizeMatchingText(booking.region) ===
          normalizeMatchingText(display.region as string | null) &&
        normalizeMatchingText(booking.postalCode) ===
          normalizeMatchingText(display.postalCode as string | null);
      add(
        proposal({
          proposalKey: `booking:${opportunity.sourceKey}`,
          state: unchanged ? "matched_unchanged" : "change",
          targetEntityType: "booking",
          sourceRecordKeys: sourceKeys,
          candidateLocalIds: [booking.id],
          proposedLocalId: booking.id,
          matchReason: "stable_opportunity_link",
          issueCode: hasResolvedPerson ? null : "needs_person",
          dependencyProposalKeys: dependencyKeys,
          displaySnapshot: {
            ...display,
            organizationId:
              parentProposal?.proposedLocalId ?? booking.organizationId,
          },
        }),
      );
      continue;
    }

    add(
      proposal({
        proposalKey: `booking:${opportunity.sourceKey}`,
        state: "new",
        targetEntityType: "booking",
        sourceRecordKeys: sourceKeys,
        matchReason: "unlinked_opportunity_creates_booking",
        issueCode: hasResolvedPerson ? null : "needs_person",
        dependencyProposalKeys: dependencyKeys,
        displaySnapshot: display,
      }),
    );
  }

  const bookingRelationshipGroups = Map.groupBy(
    opportunityContactEdges.filter(({ sourceKey }) => !owned.has(sourceKey)),
    (edge) => {
      const opportunity = opportunities.get(edge.sourceId);
      const contact = contacts.get(edge.targetSourceId ?? "");
      return `${
        opportunity
          ? proposalBySourceKey.get(opportunity.sourceKey)?.proposalKey
          : edge.sourceId
      }|${
        contact
          ? proposalBySourceKey.get(contact.sourceKey)?.proposalKey
          : edge.targetSourceId
      }`;
    },
  );
  for (const edges of bookingRelationshipGroups.values()) {
    const first = edges[0]!;
    const opportunity = opportunities.get(first.sourceId);
    const contact = contacts.get(first.targetSourceId ?? "");
    const bookingParent = opportunity
      ? proposalBySourceKey.get(opportunity.sourceKey)
      : undefined;
    const personParent = contact
      ? proposalBySourceKey.get(contact.sourceKey)
      : undefined;
    const dependencies = [bookingParent, personParent].flatMap((value) =>
      value ? [value.proposalKey] : [],
    );
    const pair =
      bookingParent?.proposedLocalId && personParent?.proposedLocalId
        ? input.local.bookingPeople.find(
            ({ bookingId, contactId }) =>
              bookingId === bookingParent.proposedLocalId &&
              contactId === personParent.proposedLocalId,
          )
        : undefined;
    const unresolved =
      !bookingParent ||
      !personParent ||
      bookingParent.issueCode === "opportunity_place_missing" ||
      bookingParent.issueCode === "opportunity_place_ambiguous" ||
      bookingParent.issueCode === "opportunity_place_errored" ||
      bookingParent.issueCode === "opportunity_place_location_incomplete";
    add(
      proposal({
        proposalKey: `booking_contact:${first.sourceKey}`,
        state: unresolved
          ? "needs_review"
          : pair
            ? "matched_unchanged"
            : "new_relationship",
        targetEntityType: "booking_contact",
        sourceRecordKeys: edges.map(({ sourceKey }) => sourceKey),
        matchReason: unresolved
          ? "relationship_parent_unresolved"
          : pair
            ? "existing_booking_person_relationship"
            : "new_booking_person_relationship",
        issueCode: unresolved ? "parent_proposal_unresolved" : null,
        dependencyProposalKeys: dependencies,
        displaySnapshot: {
          bookingId: bookingParent?.proposedLocalId ?? null,
          contactId: personParent?.proposedLocalId ?? null,
          isPrimary: pair?.isPrimary ?? false,
          role: pair?.role ?? null,
          source: pair?.source ?? "act",
        },
      }),
    );
  }

  for (const group of groups.values()) {
    const link = stableLink(input.local, "group", group.sourceId);
    add(
      proposal({
        proposalKey: `calling_list:${group.sourceKey}`,
        state: "ignored",
        targetEntityType: "calling_list",
        sourceRecordKeys: [group.sourceKey],
        matchReason: link
          ? "calling_list_target_unavailable"
          : "group_membership_semantics_unknown",
        issueCode: link
          ? "group_target_unavailable"
          : "group_membership_semantics_unknown",
        displaySnapshot: {
          name: group.normalizedSnapshot.displayName,
          description: group.normalizedSnapshot.description,
          membershipSemantics: "unknown",
          orphanedEntityId: link?.entityId ?? null,
        },
      }),
    );
  }
  for (const edge of groupContactEdges) {
    add(
      proposal({
        proposalKey: `calling_list_member:${edge.sourceKey}`,
        state: "ignored",
        targetEntityType: "calling_list_member",
        sourceRecordKeys: [edge.sourceKey],
        matchReason: "group_membership_semantics_unknown",
        issueCode: "group_membership_semantics_unknown",
        dependencyProposalKeys: [
          ...(groups.get(edge.sourceId)
            ? [
                proposalBySourceKey.get(groups.get(edge.sourceId)!.sourceKey)
                  ?.proposalKey,
              ]
            : []),
        ].filter((value): value is string => Boolean(value)),
        displaySnapshot: {
          groupSourceId: edge.sourceId,
          contactSourceId: edge.targetSourceId,
          membershipSemantics: "unknown",
        },
      }),
    );
  }

  for (const record of records) {
    if (owned.has(record.sourceKey)) continue;
    add(
      proposal({
        proposalKey: `error:unowned:${record.sourceKey}`,
        state: "error",
        targetEntityType: targetForError(record.streamType),
        sourceRecordKeys: [record.sourceKey],
        matchReason: "source_record_unowned",
        issueCode: "source_record_error",
        displaySnapshot: { sourceKey: record.sourceKey },
      }),
    );
  }

  return proposals.toSorted(
    (left, right) =>
      migrationTargetRank(left.targetEntityType) -
        migrationTargetRank(right.targetEntityType) ||
      left.proposalKey.localeCompare(right.proposalKey),
  );
}
