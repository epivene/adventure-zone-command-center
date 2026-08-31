import { describe, expect, it } from "vitest";

import {
  KNOWN_BLANK_PROFILE_ENRICHMENTS,
  KNOWN_EMPTY_TEST_PROFILES,
  cleanupKnownEmptyTestProfiles,
  enrichKnownBlankProfiles,
  type KnownBlankProfileEnrichment,
  type KnownBlankProfileEnrichmentApplyOutcome,
  type KnownBlankProfileEnrichmentRepository,
  type KnownEmptyTestProfileInspection,
  type KnownEmptyTestProfileRepository,
} from "./known-empty-test-profile-cleanup";

class FakeRepository implements KnownEmptyTestProfileRepository {
  readonly removed: Array<{ id: string; expectedName: string }> = [];

  constructor(
    private readonly inspections: Map<string, KnownEmptyTestProfileInspection | null>,
    private readonly deleteOutcomes = new Map<string, "deleted" | "missing" | "referenced">(),
  ) {}

  async inspect(id: string): Promise<KnownEmptyTestProfileInspection | null> {
    return this.inspections.get(id) ?? null;
  }

  async remove(id: string, expectedName: string): Promise<"deleted" | "missing" | "referenced"> {
    this.removed.push({ id, expectedName });
    return this.deleteOutcomes.get(id) ?? "deleted";
  }
}

class FakeEnrichmentRepository implements KnownBlankProfileEnrichmentRepository {
  readonly applied: KnownBlankProfileEnrichment[] = [];

  constructor(
    private readonly outcomes = new Map<string, KnownBlankProfileEnrichmentApplyOutcome>(),
  ) {}

  async apply(input: KnownBlankProfileEnrichment): Promise<KnownBlankProfileEnrichmentApplyOutcome> {
    this.applied.push(input);
    return this.outcomes.get(input.id) ?? "updated";
  }
}

function cleanInspection(
  candidate: (typeof KNOWN_EMPTY_TEST_PROFILES)[number],
): KnownEmptyTestProfileInspection {
  return {
    id: candidate.id,
    name: candidate.name,
    city: candidate.city,
    region: candidate.region,
    actLinkCount: 0,
    referenceCount: 0,
    profile: {
      id: candidate.id,
      name: candidate.name,
      city: candidate.city,
      region: candidate.region,
      phone: null,
      normalized_phone: null,
      address_1: null,
      address_2: null,
      postal_code: null,
      website: null,
      description: null,
      parent_organization_id: null,
      consolidated_into_id: null,
      profile_image_data_url: null,
      last_resort: false,
      last_resort_reason: null,
      filler: false,
      filler_reason: null,
    },
  };
}

describe("cleanupKnownEmptyTestProfiles", () => {
  it("deletes only the four exact, unlinked, empty test profiles", async () => {
    const repository = new FakeRepository(new Map(
      KNOWN_EMPTY_TEST_PROFILES.map((candidate) => [candidate.id, cleanInspection(candidate)]),
    ));

    const result = await cleanupKnownEmptyTestProfiles(repository);

    expect(result.deleted).toEqual(KNOWN_EMPTY_TEST_PROFILES.map((candidate) => candidate.id));
    expect(result.skipped).toEqual([]);
    expect(result.alreadyAbsent).toEqual([]);
    expect(repository.removed).toEqual(KNOWN_EMPTY_TEST_PROFILES.map((candidate) => ({
      id: candidate.id,
      expectedName: candidate.name,
    })));
  });

  it("refuses candidates whose identity, location, source, references, or profile content changed", async () => {
    const [nameChanged, sourceLinked, referenced, enriched] = KNOWN_EMPTY_TEST_PROFILES;
    const inspections = new Map<string, KnownEmptyTestProfileInspection | null>(
      KNOWN_EMPTY_TEST_PROFILES.map((candidate) => [candidate.id, cleanInspection(candidate)]),
    );

    inspections.set(nameChanged.id, {
      ...cleanInspection(nameChanged),
      name: "Real Fair",
      profile: { ...cleanInspection(nameChanged).profile, name: "Real Fair" },
    });
    inspections.set(sourceLinked.id, {
      ...cleanInspection(sourceLinked),
      actLinkCount: 1,
    });
    inspections.set(referenced.id, {
      ...cleanInspection(referenced),
      referenceCount: 1,
    });
    inspections.set(enriched.id, {
      ...cleanInspection(enriched),
      profile: { ...cleanInspection(enriched).profile, website: "https://example.org" },
    });

    const repository = new FakeRepository(inspections);
    const result = await cleanupKnownEmptyTestProfiles(repository);

    expect(result.deleted).toEqual([]);
    expect(result.skipped).toEqual([
      { id: nameChanged.id, reason: "identity_changed" },
      { id: sourceLinked.id, reason: "act_source_present" },
      { id: referenced.id, reason: "linked_records_present" },
      { id: enriched.id, reason: "profile_has_content" },
    ]);
    expect(repository.removed).toEqual([]);
  });

  it("is repeat-safe and treats a foreign-key race as a safe skip", async () => {
    const [alreadyGone, becameReferenced] = KNOWN_EMPTY_TEST_PROFILES;
    const repository = new FakeRepository(
      new Map([
        [alreadyGone.id, null],
        [becameReferenced.id, cleanInspection(becameReferenced)],
      ]),
      new Map([[becameReferenced.id, "referenced"]]),
    );

    const result = await cleanupKnownEmptyTestProfiles(repository, [alreadyGone, becameReferenced]);

    expect(result.deleted).toEqual([]);
    expect(result.alreadyAbsent).toEqual([alreadyGone.id]);
    expect(result.skipped).toEqual([
      { id: becameReferenced.id, reason: "referenced_during_delete" },
    ]);
  });
});

describe("enrichKnownBlankProfiles", () => {
  it("uses the verified identities and current organization details for all three real blank profiles", async () => {
    const repository = new FakeEnrichmentRepository();

    const result = await enrichKnownBlankProfiles(repository);

    expect(result.updated).toEqual(KNOWN_BLANK_PROFILE_ENRICHMENTS.map((profile) => profile.id));
    expect(result.alreadyCurrent).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(repository.applied).toEqual(KNOWN_BLANK_PROFILE_ENRICHMENTS);

    expect(KNOWN_BLANK_PROFILE_ENRICHMENTS).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "7fff8f6c-5e88-46ad-9f00-d1a853040a42",
        name: "Colorado Events",
        city: "Boulder",
        region: "CO",
        phone: "720-272-7467",
      }),
      expect.objectContaining({
        id: "9c6b750d-828a-4b97-b6aa-0a19c22f18cf",
        name: "Idaho Department of Fish and Game",
        city: "Boise",
        region: "ID",
        phone: "208-334-3700",
      }),
      expect.objectContaining({
        id: "e7ba291f-5d7c-48ec-9c66-7756196ee290",
        name: "Te-Moak Tribe of Western Shoshone",
        city: "Elko",
        region: "NV",
        phone: "775-738-9251",
      }),
    ]));
  });

  it("separates repeat-safe records from profiles that no longer match the verified identity", async () => {
    const [current, renamed, linked] = KNOWN_BLANK_PROFILE_ENRICHMENTS;
    const repository = new FakeEnrichmentRepository(new Map([
      [current.id, "already_current"],
      [renamed.id, "identity_changed"],
      [linked.id, "act_source_present"],
    ]));

    const result = await enrichKnownBlankProfiles(repository);

    expect(result.updated).toEqual([]);
    expect(result.alreadyCurrent).toEqual([current.id]);
    expect(result.skipped).toEqual([
      { id: renamed.id, reason: "identity_changed" },
      { id: linked.id, reason: "act_source_present" },
    ]);
  });
});
