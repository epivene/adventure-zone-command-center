import { describe, expect, it } from "vitest";

import {
  KNOWN_EMPTY_TEST_PROFILES,
  cleanupKnownEmptyTestProfiles,
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
