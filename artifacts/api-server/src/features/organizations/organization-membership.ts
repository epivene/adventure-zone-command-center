import { eq, sql } from "drizzle-orm";

import type { db as applicationDatabase } from "@/db/client";
import { organizations } from "@/db/schema";
import { OrganizationConflictError } from "./organization-conflict";
import { lockOrganizationMutationDomain } from "./organization-family-lock";

type Database = typeof applicationDatabase;

export type OrganizationMembershipResult = {
  childId: string;
  parentOrganizationId: string | null;
  previousParentOrganizationId: string | null;
};

export type SetOrganizationMembershipInput = {
  childId: string;
  parentOrganizationId: string | null;
};

export async function setOrganizationMembership(
  database: Database,
  input: SetOrganizationMembershipInput,
  now: Date,
): Promise<OrganizationMembershipResult> {
  if (input.childId === input.parentOrganizationId) {
    throw new OrganizationConflictError("A profile cannot belong to itself.");
  }

  return database.transaction(async (tx) => {
    await lockOrganizationMutationDomain(tx);

    const [child] = await tx
      .select({
        id: organizations.id,
        consolidatedIntoId: organizations.consolidatedIntoId,
        parentOrganizationId: organizations.parentOrganizationId,
      })
      .from(organizations)
      .where(eq(organizations.id, input.childId))
      .for("update");

    if (!child) {
      throw new OrganizationConflictError("Profile not found.");
    }
    if (child.consolidatedIntoId) {
      throw new OrganizationConflictError("This profile is retired and cannot change organization membership.");
    }

    if (input.parentOrganizationId) {
      const [parent] = await tx
        .select({
          id: organizations.id,
          consolidatedIntoId: organizations.consolidatedIntoId,
          parentOrganizationId: organizations.parentOrganizationId,
        })
        .from(organizations)
        .where(eq(organizations.id, input.parentOrganizationId))
        .for("update");

      if (!parent) {
        throw new OrganizationConflictError("Organization profile not found.");
      }
      if (parent.consolidatedIntoId) {
        throw new OrganizationConflictError("That organization profile is retired and cannot accept locations/events.");
      }
      if (parent.parentOrganizationId) {
        throw new OrganizationConflictError("That organization is already a location/event of another organization.");
      }

      const [children] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(organizations)
        .where(eq(organizations.parentOrganizationId, input.childId));
      if ((children?.count ?? 0) > 0) {
        throw new OrganizationConflictError("An organization that already has locations/events cannot be added beneath another organization.");
      }
    }

    const previousParentOrganizationId = child.parentOrganizationId;
    if (previousParentOrganizationId !== input.parentOrganizationId) {
      await tx
        .update(organizations)
        .set({
          parentOrganizationId: input.parentOrganizationId,
          updatedAt: now,
        })
        .where(eq(organizations.id, input.childId));
    }

    return {
      childId: input.childId,
      parentOrganizationId: input.parentOrganizationId,
      previousParentOrganizationId,
    };
  });
}
