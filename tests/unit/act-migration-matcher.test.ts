import { describe, expect, it } from "vitest";

import type {
  ActMigrationProposal,
  LocalMigrationCandidateSnapshot,
} from "@/features/act-migration/migration-types";
import { buildMigrationProposals } from "@/features/act-migration/matcher";
import type { FinalizedSourceSnapshot } from "@/features/act-migration/snapshot-repository";
import {
  parseSourceItem,
  type StagedSourceItem,
} from "@/features/act-migration/source-parser";

const emptyLocal: LocalMigrationCandidateSnapshot = {
  places: [],
  people: [],
  bookings: [],
  placePeople: [],
  bookingPeople: [],
  externalLinks: [],
};

function staged(
  streamType: Parameters<typeof parseSourceItem>[0],
  rawSnapshot: Record<string, unknown>,
): StagedSourceItem {
  const parsed = parseSourceItem(streamType, rawSnapshot);
  if (!parsed.ok) throw new Error("Expected a valid test source record.");
  const normalized = parsed.normalized as Record<string, unknown>;
  return {
    streamType,
    sourceKey: parsed.sourceKey,
    sourceId: parsed.sourceId,
    targetSourceId:
      "targetSourceId" in normalized
        ? (normalized.targetSourceId as string)
        : null,
    rawSnapshot: parsed.rawSnapshot,
    normalizedSnapshot: normalized,
    fingerprint: parsed.fingerprint,
    errorCode: null,
    errorFields: [],
  };
}

function errorRecord(
  sourceKey: string,
  errorCode = "invalid_source_record",
): StagedSourceItem {
  return {
    streamType: "contact",
    sourceKey,
    sourceId: null,
    targetSourceId: null,
    rawSnapshot: {},
    normalizedSnapshot: {},
    fingerprint: sourceKey,
    errorCode,
    errorFields: ["record"],
  };
}

function source(records: readonly StagedSourceItem[]): FinalizedSourceSnapshot {
  return {
    runId: "run-1",
    records,
    checkpoints: [],
    sourceDigest: "source-digest",
  };
}

function proposal(
  proposals: readonly ActMigrationProposal[],
  sourceKey: string,
) {
  const matches = proposals.filter(({ sourceRecordKeys }) =>
    sourceRecordKeys.includes(sourceKey),
  );
  expect(matches).toHaveLength(1);
  return matches[0]!;
}

describe("buildMigrationProposals", () => {
  it("matches Places by stable link, then unique location or verified contact fields", () => {
    const records = [
      staged("company", {
        id: "COMPANY-LINK",
        name: "Linked Fair",
        phone: "303-555-0100",
        website: "linked.example",
        address: { city: "Denver", state: "CO" },
      }),
      staged("company", {
        id: "COMPANY-LOCATION",
        name: "Location Fair",
        address: { city: "Albany", state: "NY" },
      }),
      staged("company", {
        id: "COMPANY-PHONE",
        name: "Phone Fair",
        phone: "303-555-0199",
      }),
      staged("company", {
        id: "COMPANY-AMBIGUOUS",
        name: "Repeated Fair",
      }),
    ];
    const local: LocalMigrationCandidateSnapshot = {
      ...emptyLocal,
      places: [
        {
          id: "place-linked",
          name: "Linked Fair",
          normalizedName: "linked fair",
          placeType: "other",
          actIndustry: null,
          phone: "303-555-0100",
          normalizedPhone: "+13035550100",
          address1: null,
          address2: null,
          city: "Denver",
          region: "CO",
          normalizedCity: "denver",
          normalizedRegion: "co",
          postalCode: null,
          website: "linked.example",
          normalizedWebsiteHost: "linked.example",
        },
        {
          id: "place-location",
          name: "Location Fair",
          normalizedName: "location fair",
          placeType: "other",
          actIndustry: null,
          phone: null,
          normalizedPhone: null,
          address1: null,
          address2: null,
          city: "Albany",
          region: "NY",
          normalizedCity: "albany",
          normalizedRegion: "ny",
          postalCode: null,
          website: null,
          normalizedWebsiteHost: null,
        },
        ...["place-phone", "place-repeat-a", "place-repeat-b"].map(
          (id, index) => ({
            id,
            name: index === 0 ? "Phone Fair" : "Repeated Fair",
            normalizedName:
              index === 0 ? "phone fair" : "repeated fair",
            placeType: "other",
            actIndustry: null,
            phone: index === 0 ? "303-555-0199" : null,
            normalizedPhone: index === 0 ? "+13035550199" : null,
            address1: null,
            address2: null,
            city: null,
            region: null,
            normalizedCity: null,
            normalizedRegion: null,
            postalCode: null,
            website: null,
            normalizedWebsiteHost: null,
          }),
        ),
      ],
      externalLinks: [
        {
          entityType: "organization",
          entityId: "place-linked",
          sourceEntityType: "company",
          actRecordId: "COMPANY-LINK",
          isPrimary: false,
          syncMode: "pull_only",
        },
      ],
    };

    const proposals = buildMigrationProposals({ source: source(records), local });

    expect(proposal(proposals, "company:COMPANY-LINK")).toMatchObject({
      state: "matched_unchanged",
      reviewState: "not_required",
      proposedLocalId: "place-linked",
      matchReason: "stable_company_link",
    });
    expect(proposal(proposals, "company:COMPANY-LOCATION")).toMatchObject({
      state: "possible_duplicate",
      reviewState: "pending",
      candidateLocalIds: ["place-location"],
      matchReason: "unique_name_city_region",
    });
    expect(proposal(proposals, "company:COMPANY-PHONE")).toMatchObject({
      state: "possible_duplicate",
      candidateLocalIds: ["place-phone"],
      matchReason: "unique_name_phone_or_website",
    });
    expect(proposal(proposals, "company:COMPANY-AMBIGUOUS")).toMatchObject({
      state: "needs_review",
      issueCode: "ambiguous_place_match",
      candidateLocalIds: ["place-repeat-a", "place-repeat-b"],
    });
  });

  it("consolidates Contact identities conservatively and never applies alias fields", () => {
    const records = [
      staged("contact", {
        id: "CONTACT-PRIMARY",
        fullName: "Avery Person",
        emailAddress: "avery@example.com",
        businessPhone: "303-555-0101",
      }),
      staged("contact", {
        id: "CONTACT-ALIAS",
        fullName: "Info",
        company: "Example Events",
        emailAddress: "wrong@example.com",
        businessPhone: "303-555-9999",
      }),
      staged("contact", {
        id: "CONTACT-CONSOLIDATE-A",
        fullName: "Blake Person",
        emailAddress: "blake@example.com",
      }),
      staged("contact", {
        id: "CONTACT-CONSOLIDATE-B",
        fullName: "Blake Person",
        emailAddress: "blake@example.com",
      }),
      staged("contact", {
        id: "CONTACT-SHARED",
        fullName: "Casey Person",
        emailAddress: "info@example.com",
      }),
    ];
    const people = [
      {
        id: "person-avery",
        firstName: "Avery",
        lastName: "Person",
        displayName: "Avery Person",
        normalizedName: "avery person",
        email: "avery@example.com",
        normalizedEmail: "avery@example.com",
        sharedEmail: false,
        phone: "303-555-0101",
        normalizedPhone: "+13035550101",
        jobTitle: null,
        address1: null,
        address2: null,
        city: null,
        region: null,
        postalCode: null,
      },
      {
        id: "person-blake",
        firstName: "Blake",
        lastName: "Person",
        displayName: "Blake Person",
        normalizedName: "blake person",
        email: "blake@example.com",
        normalizedEmail: "blake@example.com",
        sharedEmail: false,
        phone: null,
        normalizedPhone: null,
        jobTitle: null,
        address1: null,
        address2: null,
        city: null,
        region: null,
        postalCode: null,
      },
      {
        id: "person-casey",
        firstName: "Casey",
        lastName: "Person",
        displayName: "Casey Person",
        normalizedName: "casey person",
        email: "info@example.com",
        normalizedEmail: "info@example.com",
        sharedEmail: true,
        phone: null,
        normalizedPhone: null,
        jobTitle: null,
        address1: null,
        address2: null,
        city: null,
        region: null,
        postalCode: null,
      },
    ];
    const local: LocalMigrationCandidateSnapshot = {
      ...emptyLocal,
      people,
      externalLinks: [
        {
          entityType: "contact",
          entityId: "person-avery",
          sourceEntityType: "contact",
          actRecordId: "CONTACT-PRIMARY",
          isPrimary: true,
          syncMode: "two_way",
        },
        {
          entityType: "contact",
          entityId: "person-avery",
          sourceEntityType: "contact",
          actRecordId: "CONTACT-ALIAS",
          isPrimary: false,
          syncMode: "pull_only",
        },
      ],
    };

    const proposals = buildMigrationProposals({ source: source(records), local });
    const stable = proposal(proposals, "contact:CONTACT-PRIMARY");
    expect(stable.sourceRecordKeys).toEqual([
      "contact:CONTACT-ALIAS",
      "contact:CONTACT-PRIMARY",
    ]);
    expect(stable).toMatchObject({
      state: "matched_unchanged",
      proposedLocalId: "person-avery",
      proposedPrimarySourceId: "CONTACT-PRIMARY",
      matchReason: "stable_contact_link",
      displaySnapshot: {
        email: "avery@example.com",
        phone: "303-555-0101",
      },
    });

    const consolidation = proposal(
      proposals,
      "contact:CONTACT-CONSOLIDATE-A",
    );
    expect(consolidation.sourceRecordKeys).toEqual([
      "contact:CONTACT-CONSOLIDATE-A",
      "contact:CONTACT-CONSOLIDATE-B",
    ]);
    expect(consolidation).toMatchObject({
      state: "possible_duplicate",
      reviewState: "pending",
      proposedLocalId: "person-blake",
      proposedPrimarySourceId: null,
      candidateLocalIds: ["person-blake"],
    });
    expect(proposal(proposals, "contact:CONTACT-SHARED")).toMatchObject({
      state: "needs_review",
      issueCode: "shared_mailbox_match_blocked",
      proposedLocalId: null,
      candidateLocalIds: ["person-casey"],
    });
  });

  it("uses a pull-only alias for identity but never to propose Person field changes", () => {
    const record = staged("contact", {
      id: "CONTACT-ALIAS",
      fullName: "Wrong Alias Name",
      emailAddress: "wrong@example.com",
      businessPhone: "303-555-9999",
    });
    const local: LocalMigrationCandidateSnapshot = {
      ...emptyLocal,
      people: [
        {
          id: "person-1",
          firstName: "Avery",
          lastName: "Person",
          displayName: "Avery Person",
          normalizedName: "avery person",
          email: "avery@example.com",
          normalizedEmail: "avery@example.com",
          sharedEmail: false,
          phone: "303-555-0101",
          normalizedPhone: "+13035550101",
          jobTitle: null,
          address1: null,
          address2: null,
          city: null,
          region: null,
          postalCode: null,
        },
      ],
      externalLinks: [
        {
          entityType: "contact",
          entityId: "person-1",
          sourceEntityType: "contact",
          actRecordId: "CONTACT-ALIAS",
          isPrimary: false,
          syncMode: "pull_only",
        },
      ],
    };

    expect(
      proposal(
        buildMigrationProposals({ source: source([record]), local }),
        record.sourceKey,
      ),
    ).toMatchObject({
      state: "matched_unchanged",
      reviewState: "not_required",
      proposedLocalId: "person-1",
      proposedPrimarySourceId: null,
      matchReason: "stable_contact_alias",
    });
  });

  it("folds exactly owned company-only Contacts into one Place proposal", () => {
    const records = [
      staged("company", {
        id: "COMPANY-1",
        name: "Example Events",
        website: "events.example",
        address: { city: "Denver", state: "CO" },
      }),
      staged("contact", {
        id: "CONTACT-GENERIC",
        fullName: "Example Events",
        company: "Example Events",
        emailAddress: "info@example.com",
        businessPhone: "303-555-0100",
        businessAddress: { line1: "100 Main", postalCode: "80202" },
      }),
      staged("company_contact", {
        sourceId: "COMPANY-1",
        targetSourceId: "CONTACT-GENERIC",
      }),
    ];

    const proposals = buildMigrationProposals({
      source: source(records),
      local: emptyLocal,
    });
    const place = proposal(proposals, "company:COMPANY-1");

    expect(place.sourceRecordKeys).toEqual([
      "company:COMPANY-1",
      "company_contact:COMPANY-1:CONTACT-GENERIC",
      "contact:CONTACT-GENERIC",
    ]);
    expect(place).toMatchObject({
      targetEntityType: "organization",
      state: "new",
      displaySnapshot: {
        name: "Example Events",
        phone: "303-555-0100",
        address1: "100 Main",
        city: "Denver",
        region: "CO",
        postalCode: "80202",
        website: "events.example",
        ignoredContactEmail: "info@example.com",
      },
    });
    expect(
      proposals.some(({ targetEntityType }) => targetEntityType === "contact"),
    ).toBe(false);
  });

  it("keeps unresolved company-only ownership visible without creating a Person", () => {
    const records = [
      staged("company", {
        id: "COMPANY-A",
        name: "A",
        address: { city: "Denver", state: "CO" },
      }),
      staged("company", {
        id: "COMPANY-B",
        name: "B",
        address: { city: "Denver", state: "CO" },
      }),
      staged("contact", {
        id: "CONTACT-GENERIC",
        fullName: "Info",
      }),
      staged("company_contact", {
        sourceId: "COMPANY-A",
        targetSourceId: "CONTACT-GENERIC",
      }),
      staged("company_contact", {
        sourceId: "COMPANY-B",
        targetSourceId: "CONTACT-GENERIC",
      }),
    ];

    const proposals = buildMigrationProposals({
      source: source(records),
      local: emptyLocal,
    });
    const unresolved = proposal(proposals, "contact:CONTACT-GENERIC");

    expect(unresolved).toMatchObject({
      targetEntityType: "organization",
      state: "needs_review",
      reviewState: "pending",
      issueCode: "company_only_contact_unresolved",
    });
    expect(unresolved.sourceRecordKeys).toEqual([
      "company_contact:COMPANY-A:CONTACT-GENERIC",
      "company_contact:COMPANY-B:CONTACT-GENERIC",
      "contact:CONTACT-GENERIC",
    ]);
    expect(unresolved.dependencyProposalKeys).toHaveLength(2);
  });

  it("creates Bookings only from one reliable Place and never fuzzy-merges", () => {
    const records = [
      staged("company", {
        id: "COMPANY-1",
        name: "Example Place",
        address: {
          line1: "100 Main",
          city: "Denver",
          state: "CO",
          postalCode: "80202",
        },
      }),
      staged("company", {
        id: "COMPANY-2",
        name: "Second Place",
        address: { city: "Boulder", state: "CO" },
      }),
      staged("opportunity", {
        id: "OPPORTUNITY-NEW",
        name: "Annual Fair",
        status: "Won",
        probability: 100,
      }),
      staged("opportunity_company", {
        sourceId: "OPPORTUNITY-NEW",
        targetSourceId: "COMPANY-1",
      }),
      staged("opportunity", {
        id: "OPPORTUNITY-MISSING",
        name: "No Place",
      }),
      staged("opportunity", {
        id: "OPPORTUNITY-AMBIGUOUS",
        name: "Two Places",
      }),
      staged("opportunity_company", {
        sourceId: "OPPORTUNITY-AMBIGUOUS",
        targetSourceId: "COMPANY-1",
      }),
      staged("opportunity_company", {
        sourceId: "OPPORTUNITY-AMBIGUOUS",
        targetSourceId: "COMPANY-2",
      }),
    ];
    const local: LocalMigrationCandidateSnapshot = {
      ...emptyLocal,
      bookings: [
        {
          id: "same-name-booking",
          organizationId: null,
          primaryContactId: null,
          name: "Annual Fair",
          venueName: null,
          address1: "100 Main",
          city: "Denver",
          region: "CO",
          postalCode: "80202",
          startsAt: null,
          endsAt: null,
          status: "new_lead",
          probability: "possible",
          notes: null,
        },
      ],
    };

    const proposals = buildMigrationProposals({ source: source(records), local });
    const booking = proposal(proposals, "opportunity:OPPORTUNITY-NEW");
    expect(booking.sourceRecordKeys).toEqual([
      "opportunity:OPPORTUNITY-NEW",
      "opportunity_company:OPPORTUNITY-NEW:COMPANY-1",
    ]);
    expect(booking).toMatchObject({
      targetEntityType: "booking",
      state: "new",
      reviewState: "pending",
      proposedLocalId: null,
      candidateLocalIds: [],
      issueCode: "needs_person",
      displaySnapshot: {
        name: "Annual Fair",
        city: "Denver",
        region: "CO",
        startsAt: null,
        endsAt: null,
        status: "new_lead",
        probability: "possible",
        primaryContactId: null,
        sourceStatus: "Won",
        sourceProbability: 100,
      },
    });
    expect(booking.dependencyProposalKeys).toHaveLength(1);
    expect(proposal(proposals, "opportunity:OPPORTUNITY-MISSING")).toMatchObject({
      state: "needs_review",
      issueCode: "opportunity_place_missing",
      candidateLocalIds: [],
    });
    expect(
      proposal(proposals, "opportunity:OPPORTUNITY-AMBIGUOUS"),
    ).toMatchObject({
      state: "needs_review",
      issueCode: "opportunity_place_ambiguous",
    });
    expect(
      proposal(proposals, "opportunity:OPPORTUNITY-AMBIGUOUS")
        .dependencyProposalKeys,
    ).toHaveLength(2);
  });

  it("preserves existing relationship metadata and gives new relationships neutral metadata", () => {
    const records = [
      staged("company", {
        id: "COMPANY-1",
        name: "Example Place",
        address: { city: "Denver", state: "CO" },
      }),
      staged("contact", {
        id: "CONTACT-1",
        fullName: "Avery Person",
      }),
      staged("company_contact", {
        sourceId: "COMPANY-1",
        targetSourceId: "CONTACT-1",
      }),
      staged("opportunity", {
        id: "OPPORTUNITY-1",
        name: "Annual Fair",
      }),
      staged("opportunity_company", {
        sourceId: "OPPORTUNITY-1",
        targetSourceId: "COMPANY-1",
      }),
      staged("opportunity_contact", {
        sourceId: "OPPORTUNITY-1",
        targetSourceId: "CONTACT-1",
      }),
    ];
    const local: LocalMigrationCandidateSnapshot = {
      ...emptyLocal,
      places: [
        {
          id: "place-1",
          name: "Example Place",
          normalizedName: "example place",
          placeType: "other",
          actIndustry: null,
          phone: null,
          normalizedPhone: null,
          address1: null,
          address2: null,
          city: "Denver",
          region: "CO",
          normalizedCity: "denver",
          normalizedRegion: "co",
          postalCode: null,
          website: null,
          normalizedWebsiteHost: null,
        },
      ],
      people: [
        {
          id: "person-1",
          firstName: "Avery",
          lastName: "Person",
          displayName: "Avery Person",
          normalizedName: "avery person",
          email: null,
          normalizedEmail: null,
          sharedEmail: false,
          phone: null,
          normalizedPhone: null,
          jobTitle: null,
          address1: null,
          address2: null,
          city: null,
          region: null,
          postalCode: null,
        },
      ],
      placePeople: [
        {
          organizationId: "place-1",
          contactId: "person-1",
          active: false,
          isPrimary: false,
          role: "Coordinator",
          source: "local",
        },
      ],
      externalLinks: [
        {
          entityType: "organization",
          entityId: "place-1",
          sourceEntityType: "company",
          actRecordId: "COMPANY-1",
          isPrimary: false,
          syncMode: "pull_only",
        },
        {
          entityType: "contact",
          entityId: "person-1",
          sourceEntityType: "contact",
          actRecordId: "CONTACT-1",
          isPrimary: true,
          syncMode: "two_way",
        },
      ],
    };

    const proposals = buildMigrationProposals({ source: source(records), local });
    expect(
      proposal(proposals, "company_contact:COMPANY-1:CONTACT-1"),
    ).toMatchObject({
      state: "change",
      reviewState: "pending",
      targetEntityType: "organization_contact",
      displaySnapshot: {
        active: true,
        isPrimary: false,
        role: "Coordinator",
        source: "local",
      },
    });
    expect(
      proposal(proposals, "opportunity_contact:OPPORTUNITY-1:CONTACT-1"),
    ).toMatchObject({
      state: "new_relationship",
      targetEntityType: "booking_contact",
      displaySnapshot: {
        isPrimary: false,
        role: null,
      },
    });
  });

  it("owns Groups, Group members, and staged errors exactly once", () => {
    const records = [
      staged("group", { id: "GROUP-1", name: "Legacy List" }),
      staged("group_contact", {
        sourceId: "GROUP-1",
        targetSourceId: "CONTACT-1",
      }),
      errorRecord(
        "error:contact:conflict",
        "duplicate_source_id_conflict",
      ),
    ];
    const local: LocalMigrationCandidateSnapshot = {
      ...emptyLocal,
      externalLinks: [
        {
          entityType: "calling_list",
          entityId: "missing-list",
          sourceEntityType: "group",
          actRecordId: "GROUP-1",
          isPrimary: false,
          syncMode: "pull_only",
        },
      ],
    };

    const proposals = buildMigrationProposals({ source: source(records), local });
    expect(proposal(proposals, "group:GROUP-1")).toMatchObject({
      targetEntityType: "calling_list",
      state: "ignored",
      issueCode: "group_target_unavailable",
    });
    expect(
      proposal(proposals, "group_contact:GROUP-1:CONTACT-1"),
    ).toMatchObject({
      targetEntityType: "calling_list_member",
      state: "ignored",
      issueCode: "group_membership_semantics_unknown",
    });
    expect(proposal(proposals, "error:contact:conflict")).toMatchObject({
      state: "error",
      issueCode: "duplicate_source_id_conflict",
    });

    expect(proposals.map(({ targetEntityType }) => targetEntityType)).toEqual(
      proposals
        .map(({ targetEntityType }) => targetEntityType)
        .toSorted((left, right) => {
          const order = [
            "organization",
            "contact",
            "organization_contact",
            "booking",
            "booking_contact",
            "calling_list",
            "calling_list_member",
          ];
          return order.indexOf(left) - order.indexOf(right);
        }),
    );
    expect(
      proposals.flatMap(({ sourceRecordKeys }) => sourceRecordKeys).toSorted(),
    ).toEqual(records.map(({ sourceKey }) => sourceKey).toSorted());
  });
});
