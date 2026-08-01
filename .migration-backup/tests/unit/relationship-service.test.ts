import { describe, expect, it } from "vitest";

import type { RelationshipRepository } from "@/features/relationships/relationship-repository";
import { RelationshipService } from "@/features/relationships/relationship-service";
import type {
  AssociatePersonWithPlaceInput,
  PlacePersonRelationship,
  RelationshipWriteResult,
  SetPersonPrimaryPlaceInput,
  SetPlacePersonActiveInput,
  SetPlacePrimaryPersonInput,
} from "@/features/relationships/relationship-types";

const ids = {
  place: "11111111-1111-4111-8111-111111111111",
  person: "22222222-2222-4222-8222-222222222222",
};

const relationship: PlacePersonRelationship = {
  id: "33333333-3333-4333-8333-333333333333",
  organizationId: ids.place,
  contactId: ids.person,
  role: null,
  isPrimary: false,
  active: true,
  source: "local",
};

class RecordingRelationshipRepository implements RelationshipRepository {
  public associateCalls = 0;
  public associateResult: RelationshipWriteResult = { kind: "ok", relationship };
  public setPersonPrimaryResult: RelationshipWriteResult | { kind: "cleared" } = { kind: "ok", relationship };
  public setPlacePrimaryResult: RelationshipWriteResult = { kind: "ok", relationship };
  public setActiveResult: RelationshipWriteResult = { kind: "ok", relationship };

  async associatePersonWithPlace(_input: AssociatePersonWithPlaceInput, _now: Date) {
    this.associateCalls += 1;
    return this.associateResult;
  }

  async setPersonPrimaryPlace(_input: SetPersonPrimaryPlaceInput, _now: Date) {
    return this.setPersonPrimaryResult;
  }

  async setPlacePrimaryPerson(_input: SetPlacePrimaryPersonInput, _now: Date) {
    return this.setPlacePrimaryResult;
  }

  async setPlacePersonActive(_input: SetPlacePersonActiveInput, _now: Date) {
    return this.setActiveResult;
  }

  async listPeopleForPlace(_organizationId: string, _includeInactive?: boolean) {
    return [];
  }

  async listPlacesForPerson(_contactId: string, _includeInactive?: boolean) {
    return [];
  }
}

function createService(repository = new RecordingRelationshipRepository()) {
  return {
    repository,
    service: new RelationshipService(repository, {
      now: () => new Date("2026-07-29T00:00:00.000Z"),
    }),
  };
}

describe("RelationshipService", () => {
  it("returns validation errors before calling the repository", async () => {
    const { repository, service } = createService();
    await expect(service.associatePersonWithPlace({
      organizationId: "not-an-id",
      contactId: ids.person,
      role: null,
    })).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_RELATIONSHIP_INPUT" },
    });
    expect(repository.associateCalls).toBe(0);
  });

  it("maps a missing Place", async () => {
    const { repository, service } = createService();
    repository.associateResult = { kind: "place_not_found" };
    await expect(service.associatePersonWithPlace({
      organizationId: ids.place,
      contactId: ids.person,
      role: null,
    })).resolves.toEqual({ ok: false, error: { code: "PLACE_NOT_FOUND" } });
  });

  it("maps a missing Person", async () => {
    const { repository, service } = createService();
    repository.associateResult = { kind: "person_not_found" };
    await expect(service.associatePersonWithPlace({
      organizationId: ids.place,
      contactId: ids.person,
      role: null,
    })).resolves.toEqual({ ok: false, error: { code: "PERSON_NOT_FOUND" } });
  });

  it("maps a missing relationship", async () => {
    const { repository, service } = createService();
    repository.setPlacePrimaryResult = { kind: "relationship_not_found" };
    await expect(service.setPlacePrimaryPerson({
      organizationId: ids.place,
      contactId: ids.person,
    })).resolves.toEqual({ ok: false, error: { code: "RELATIONSHIP_NOT_FOUND" } });
  });

  it("rejects deactivating a primary relationship", async () => {
    const { repository, service } = createService();
    repository.setActiveResult = { kind: "primary_relationship_cannot_be_inactive" };
    await expect(service.setPlacePersonActive({
      organizationId: ids.place,
      contactId: ids.person,
      active: false,
    })).resolves.toEqual({
      ok: false,
      error: { code: "PRIMARY_RELATIONSHIP_CANNOT_BE_INACTIVE" },
    });
  });
});
