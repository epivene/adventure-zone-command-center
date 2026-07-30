import {
  associatePersonWithPlaceSchema,
  setPersonPrimaryPlaceSchema,
  setPlacePersonActiveSchema,
  setPlacePrimaryPersonSchema,
} from "@/features/relationships/relationship-input";
import type { RelationshipRepository } from "@/features/relationships/relationship-repository";
import type {
  AssociatePersonWithPlaceInput,
  PlacePersonRelationship,
  RelationshipError,
  RelationshipWriteResult,
  SetPersonPrimaryPlaceInput,
  SetPlacePersonActiveInput,
  SetPlacePrimaryPersonInput,
} from "@/features/relationships/relationship-types";
import { err, ok, type Result } from "@/lib/result";

function invalidInput(message: string): Result<never, RelationshipError> {
  return err({ code: "INVALID_RELATIONSHIP_INPUT", message });
}

function mapWriteResult(
  result: RelationshipWriteResult,
): Result<PlacePersonRelationship, RelationshipError> {
  switch (result.kind) {
    case "ok":
      return ok(result.relationship);
    case "place_not_found":
      return err({ code: "PLACE_NOT_FOUND" });
    case "person_not_found":
      return err({ code: "PERSON_NOT_FOUND" });
    case "relationship_not_found":
      return err({ code: "RELATIONSHIP_NOT_FOUND" });
    case "primary_relationship_cannot_be_inactive":
      return err({ code: "PRIMARY_RELATIONSHIP_CANNOT_BE_INACTIVE" });
  }
}

export class RelationshipService {
  private readonly now: () => Date;

  constructor(
    private readonly repository: RelationshipRepository,
    options: { now?: () => Date } = {},
  ) {
    this.now = options.now ?? (() => new Date());
  }

  async associatePersonWithPlace(
    input: AssociatePersonWithPlaceInput,
  ): Promise<Result<PlacePersonRelationship, RelationshipError>> {
    const parsed = associatePersonWithPlaceSchema.safeParse(input);
    if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message ?? "Review the relationship details.");
    return mapWriteResult(await this.repository.associatePersonWithPlace(parsed.data, this.now()));
  }

  async setPersonPrimaryPlace(
    input: SetPersonPrimaryPlaceInput,
  ): Promise<Result<PlacePersonRelationship | null, RelationshipError>> {
    const parsed = setPersonPrimaryPlaceSchema.safeParse(input);
    if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message ?? "Review the primary Place.");
    const result = await this.repository.setPersonPrimaryPlace(parsed.data, this.now());
    if (result.kind === "cleared") return ok(null);
    return mapWriteResult(result);
  }

  async setPlacePrimaryPerson(
    input: SetPlacePrimaryPersonInput,
  ): Promise<Result<PlacePersonRelationship, RelationshipError>> {
    const parsed = setPlacePrimaryPersonSchema.safeParse(input);
    if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message ?? "Review the primary Person.");
    return mapWriteResult(await this.repository.setPlacePrimaryPerson(parsed.data, this.now()));
  }

  async setPlacePersonActive(
    input: SetPlacePersonActiveInput,
  ): Promise<Result<PlacePersonRelationship, RelationshipError>> {
    const parsed = setPlacePersonActiveSchema.safeParse(input);
    if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message ?? "Review the relationship status.");
    return mapWriteResult(await this.repository.setPlacePersonActive(parsed.data, this.now()));
  }
}
