import type { db as database } from "@/db/client";

export type RelationshipSource =
  | "local"
  | "act_sync"
  | "act_import"
  | "legacy_backfill"
  | "act_migration"
  | "undo";

export type PlacePersonRelationship = {
  id: string;
  organizationId: string;
  contactId: string;
  role: string | null;
  isPrimary: boolean;
  active: boolean;
  source: string;
};

export type RelationshipWriteResult =
  | { kind: "ok"; relationship: PlacePersonRelationship }
  | { kind: "place_not_found" }
  | { kind: "person_not_found" }
  | { kind: "relationship_not_found" }
  | { kind: "primary_relationship_cannot_be_inactive" };

type DrizzleDatabase = typeof database;
export type RelationshipWriter = Pick<
  DrizzleDatabase,
  "select" | "insert" | "update" | "delete"
>;

export type AssociatePersonWithPlaceInput = {
  organizationId: string;
  contactId: string;
  role: string | null;
};

export type SetPersonPrimaryPlaceInput = {
  contactId: string;
  organizationId: string | null;
};

export type SetPlacePrimaryPersonInput = {
  organizationId: string;
  contactId: string;
};

export type SetPlacePersonActiveInput = {
  organizationId: string;
  contactId: string;
  active: boolean;
};

export type RelationshipError =
  | { code: "INVALID_RELATIONSHIP_INPUT"; message: string }
  | { code: "PLACE_NOT_FOUND" }
  | { code: "PERSON_NOT_FOUND" }
  | { code: "RELATIONSHIP_NOT_FOUND" }
  | { code: "PRIMARY_RELATIONSHIP_CANNOT_BE_INACTIVE" };
