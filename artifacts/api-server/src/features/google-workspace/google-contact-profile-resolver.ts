import { and, asc, eq, isNull } from "drizzle-orm";

import { db as defaultDb } from "@/db/client";
import { organizationContacts, organizations } from "@/db/schema";

export type ContactOrganizationCandidate = {
  id: string;
  name: string;
};

export type ContactProfileResolution = {
  contactId: string;
  status: "resolved" | "ambiguous" | "unresolved";
  organization: ContactOrganizationCandidate | null;
  candidates: ContactOrganizationCandidate[];
};

type RelationshipAccess = {
  listActiveOrganizationsForContact(contactId: string): Promise<Array<{
    contactId: string;
    organizationId: string;
    organizationName: string;
  }>>;
};

type DrizzleDb = typeof defaultDb;

export class PostgresContactOrganizationRelationships implements RelationshipAccess {
  constructor(private readonly database: DrizzleDb = defaultDb) {}

  async listActiveOrganizationsForContact(contactId: string) {
    return this.database
      .select({
        contactId: organizationContacts.contactId,
        organizationId: organizations.id,
        organizationName: organizations.name,
      })
      .from(organizationContacts)
      .innerJoin(
        organizations,
        eq(organizations.id, organizationContacts.organizationId),
      )
      .where(
        and(
          eq(organizationContacts.contactId, contactId),
          eq(organizationContacts.active, true),
          isNull(organizations.consolidatedIntoId),
        ),
      )
      .orderBy(asc(organizations.name), asc(organizations.id));
  }
}

export class GoogleContactProfileResolver {
  private readonly relationships: RelationshipAccess;

  constructor(options?: { relationships?: RelationshipAccess }) {
    this.relationships =
      options?.relationships ?? new PostgresContactOrganizationRelationships();
  }

  async resolve(contactId: string): Promise<ContactProfileResolution> {
    const rows = await this.relationships.listActiveOrganizationsForContact(contactId);
    const seen = new Set<string>();
    const candidates = rows.flatMap((row) => {
      if (seen.has(row.organizationId)) return [];
      seen.add(row.organizationId);
      return [{ id: row.organizationId, name: row.organizationName }];
    });

    if (candidates.length === 1) {
      return {
        contactId,
        status: "resolved",
        organization: candidates[0],
        candidates,
      };
    }
    if (candidates.length > 1) {
      return {
        contactId,
        status: "ambiguous",
        organization: null,
        candidates,
      };
    }
    return {
      contactId,
      status: "unresolved",
      organization: null,
      candidates: [],
    };
  }
}
